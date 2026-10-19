import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import ssh2, { type ConnectConfig } from 'ssh2';
import { atomicWriteJson } from '@automaker/utils';
import type { SSHEnvironmentProfile, SSHHostKey, SSHProjectBinding } from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import { ExecutionEnvironmentError } from './runtime.js';
import { connectSSH, sshFingerprint } from './ssh-transport.js';

export const sshDigest = (value: string) => createHash('sha256').update(value).digest('hex');
const serial = new Map<string, Promise<unknown>>();
export async function sshSerialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (serial.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  serial.set(key, next);
  try {
    return await next;
  } finally {
    if (serial.get(key) === next) serial.delete(key);
  }
}
export async function readSSHState<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ExecutionEnvironmentError(
      'SSH_STATE_INVALID',
      'SSH server state is unreadable. Inspect state before continuing.'
    );
  }
}
export class SSHState {
  readonly directory: string;
  constructor(settings: SettingsService) {
    this.directory = path.join(settings.getDataDirectory(), 'execution-environments', 'ssh');
  }
  endpoint(profile: SSHEnvironmentProfile) {
    return sshDigest(`${profile.host.toLowerCase()}\0${profile.port}`);
  }
  private file(kind: string, id: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id))
      throw new ExecutionEnvironmentError(
        'SSH_INVALID_ID',
        'Invalid SSH credential or state identifier.'
      );
    return path.join(this.directory, kind, `${id}.json`);
  }
  private async write(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await atomicWriteJson(file, value, { mode: 0o600 });
  }
  async owner() {
    const file = path.join(this.directory, 'installation.json');
    return sshSerialized(file, async () => {
      let state = await readSSHState<{ owner: string }>(file);
      if (!state) {
        state = { owner: sshDigest(randomUUID()) };
        await this.write(file, state);
      }
      if (!/^[a-f0-9]{64}$/.test(state.owner))
        throw new ExecutionEnvironmentError('SSH_STATE_INVALID', 'SSH owner state is invalid.');
      return state.owner;
    });
  }
  async keyStatus(id?: string) {
    return !!id && !!(await readSSHState(this.file('credentials', id)));
  }
  async saveKey(id: string, privateKey: string, passphrase?: string) {
    if (
      typeof privateKey !== 'string' ||
      privateKey.length > 131072 ||
      !privateKey.trim() ||
      (passphrase !== undefined && (typeof passphrase !== 'string' || passphrase.length > 4096))
    )
      throw new ExecutionEnvironmentError(
        'SSH_INVALID_KEY',
        'Provide a valid SSH private key and optional passphrase.'
      );
    const parsed = ssh2.utils.parseKey(privateKey, passphrase);
    if (!parsed || parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey())
      throw new ExecutionEnvironmentError(
        'SSH_INVALID_KEY',
        'Provide one private key that can be parsed/decrypted (not a public key).'
      );
    await sshSerialized(this.file('credentials', id), () =>
      this.write(this.file('credentials', id), { privateKey, passphrase })
    );
  }
  async removeKey(id: string) {
    await fs.unlink(this.file('credentials', id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  async trust(profile: SSHEnvironmentProfile) {
    return readSSHState<SSHHostKey>(this.file('hosts', this.endpoint(profile)));
  }
  async scan(profile: SSHEnvironmentProfile, signal?: AbortSignal): Promise<SSHHostKey> {
    let key: SSHHostKey | undefined;
    try {
      const client = await connectSSH(
        {
          host: profile.host,
          port: profile.port,
          username: profile.username,
          hostVerifier: (raw: Buffer) => {
            const length = raw.readUInt32BE(0);
            const algorithm = raw.subarray(4, 4 + length).toString('ascii');
            if (length > 128 || !/^[a-zA-Z0-9@._+-]+$/.test(algorithm)) return false;
            key = { algorithm, fingerprint: sshFingerprint(raw) };
            return false;
          },
        },
        signal
      );
      client.end();
    } catch {
      /* Scan intentionally rejects the key before authentication. */
    }
    if (signal?.aborted) signal.throwIfAborted();
    if (!key)
      throw new ExecutionEnvironmentError(
        'SSH_SCAN_FAILED',
        'SSH host key could not be read. Check the server address, port and network.'
      );
    return key;
  }
  async confirm(
    profile: SSHEnvironmentProfile,
    fingerprint: string,
    replace: boolean,
    signal?: AbortSignal
  ) {
    const candidate = await this.scan(profile, signal);
    if (candidate.fingerprint !== fingerprint)
      throw new ExecutionEnvironmentError(
        'SSH_HOST_KEY_CHANGED',
        'The host fingerprint changed since inspection. Verify it out of band and scan again.'
      );
    const file = this.file('hosts', this.endpoint(profile));
    await sshSerialized(file, async () => {
      const current = await this.trust(profile);
      if (current && current.fingerprint !== fingerprint && !replace)
        throw new ExecutionEnvironmentError(
          'SSH_HOST_KEY_CHANGED',
          'Replacing a trusted host key requires explicit replacement acceptance. Existing runs retain their old fingerprint.'
        );
      await this.write(file, candidate);
    });
  }
  async configuration(
    profile: SSHEnvironmentProfile,
    fingerprint?: string
  ): Promise<ConnectConfig> {
    const trusted = await this.trust(profile);
    if (!trusted)
      throw new ExecutionEnvironmentError(
        'SSH_TRUST_REQUIRED',
        'Inspect and explicitly confirm the SSH host fingerprint before connecting.'
      );
    if (fingerprint && trusted.fingerprint !== fingerprint)
      throw new ExecutionEnvironmentError(
        'SSH_HOST_KEY_CHANGED',
        'This run is pinned to a different SSH host fingerprint. No migration or Local fallback was performed.'
      );
    let authentication: Partial<ConnectConfig>;
    if (profile.credentialId) {
      const key = await readSSHState<{ privateKey: string; passphrase?: string }>(
        this.file('credentials', profile.credentialId)
      );
      if (!key)
        throw new ExecutionEnvironmentError(
          'SSH_CREDENTIAL_REQUIRED',
          'The referenced private key is unavailable. Save it in SSH settings or configure the server ssh-agent.'
        );
      authentication = { privateKey: key.privateKey, passphrase: key.passphrase };
    } else {
      if (!process.env.SSH_AUTH_SOCK)
        throw new ExecutionEnvironmentError(
          'SSH_CREDENTIAL_REQUIRED',
          'No private key is selected and the Automaker server has no SSH_AUTH_SOCK.'
        );
      authentication = { agent: process.env.SSH_AUTH_SOCK };
    }
    return {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      ...authentication,
      agentForward: false,
      hostVerifier: (raw: Buffer) => sshFingerprint(raw) === trusted.fingerprint,
    };
  }
  projectKey(profile: SSHEnvironmentProfile, fingerprint: string, projectPath: string) {
    return sshDigest(
      JSON.stringify([
        profile.host,
        profile.port,
        profile.username,
        profile.basePath,
        fingerprint,
        projectPath,
      ])
    );
  }
  projectFile(profile: SSHEnvironmentProfile, fingerprint: string, projectPath: string) {
    return this.file('projects', this.projectKey(profile, fingerprint, projectPath));
  }
  async project(profile: SSHEnvironmentProfile, fingerprint: string, projectPath: string) {
    return readSSHState<SSHProjectBinding>(this.projectFile(profile, fingerprint, projectPath));
  }
  saveProject(binding: SSHProjectBinding) {
    return this.write(
      this.projectFile(binding.profile, binding.fingerprint, binding.projectPath),
      binding
    );
  }
}
