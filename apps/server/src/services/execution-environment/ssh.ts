import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { atomicWriteJson } from '@automaker/utils';
import type {
  SSHDiagnostic,
  SSHEnvironmentProfile,
  SSHEnvironmentStatus,
  SSHProjectBinding,
  SSHFeatureWorkspace,
} from '@automaker/types';
import { SSHState, sshDigest, readSSHState, sshSerialized } from './ssh-state.js';
import {
  connectSSH,
  execSSH,
  nodeCommand,
  shellQuote,
  SSHTransportError,
  type SSHCommandOptions,
} from './ssh-transport.js';
import {
  SSH_CANCEL,
  SSH_CANCEL_HASH,
  SSH_CHECK,
  SSH_INSTALL,
  SSH_LOAD,
  SSH_VERIFY,
  SSH_WORKER,
  SSH_WORKER_HASH,
} from './ssh-worker.js';
import type { SettingsService } from '../settings-service.js';
import { WorkerStream } from './worker-stream.js';
import {
  ExecutionEnvironmentError,
  type ExecutionEnvironment,
  type EnvironmentEntry,
  type EnvironmentCommandResult,
  type EnvironmentSearchOptions,
  type EnvironmentSearchResult,
  type EnvironmentProcessOutput,
  type EnvironmentProcessRequest,
} from './runtime.js';

const execFileAsync = promisify(execFile);
const activeJobs = new Set<string>();
interface Worker {
  basePath: string;
  root: string;
  identity: string;
  workerPath: string;
  workerHash: string;
  cancelPath: string;
  cancelHash: string;
  jobsDirectory: string;
}
interface Job {
  id: string;
  status: 'running' | 'unknown';
  cwd: string;
  operation: string;
  createdAt: string;
}
const validPath = (value: string) =>
  typeof value === 'string' &&
  value.startsWith('/') &&
  value !== '/' &&
  value.length <= 4096 &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  !value.split('/').includes('..');
export type SSHProjectSource =
  | { method: 'clone'; repositoryUrl: string }
  | { method: 'import' }
  | { method: 'existing'; remotePath: string };

export class ManagedSSH {
  readonly state: SSHState;
  constructor(settings: SettingsService) {
    this.state = new SSHState(settings);
  }
  async run(
    profile: SSHEnvironmentProfile,
    fingerprint: string,
    command: string,
    options: SSHCommandOptions = {}
  ) {
    const config = await this.state.configuration(profile, fingerprint).catch((error) => {
      if (error instanceof ExecutionEnvironmentError)
        throw new SSHTransportError(error.code, error.message);
      throw error;
    });
    const client = await connectSSH(config, options.signal);
    try {
      return await execSSH(client, command, options);
    } finally {
      client.end();
    }
  }
  async status(
    profile: SSHEnvironmentProfile,
    projectPath?: string
  ): Promise<SSHEnvironmentStatus> {
    const trustedHost = await this.state.trust(profile);
    const binding =
      projectPath && trustedHost
        ? await this.state.project(profile, trustedHost.fingerprint, await fs.realpath(projectPath))
        : undefined;
    return {
      trustedHost,
      hasPrivateKey: await this.state.keyStatus(profile.credentialId),
      agentAvailable: !!process.env.SSH_AUTH_SOCK,
      ...(binding && {
        project: {
          remotePath: binding.remotePath,
          preparing: !binding.ready,
          stagingPath: binding.preparationPath,
          pendingOperations: (await this.jobs(binding)).filter(
            (job) => job.status === 'unknown' || !activeJobs.has(job.id)
          ).length,
        },
      }),
    };
  }
  async diagnose(
    profile: SSHEnvironmentProfile,
    projectPath?: string,
    signal?: AbortSignal
  ): Promise<SSHDiagnostic> {
    const checkedAt = new Date().toISOString();
    const hostKey = await this.state.scan(profile, signal);
    const trusted = await this.state.trust(profile);
    if (!trusted)
      return {
        status: 'trust-required',
        checkedAt,
        hostKey,
        worker: 'not-tested',
        project: 'not-tested',
        message:
          'Compare this SHA256 fingerprint out of band and confirm it before authentication. Scanning alone does not establish trust.',
      };
    if (trusted.fingerprint !== hostKey.fingerprint)
      return {
        status: 'host-key-changed',
        checkedAt,
        hostKey,
        worker: 'not-tested',
        project: 'not-tested',
        message:
          'SSH host key changed. Authentication and execution were refused. Existing runs retain their pinned fingerprint.',
      };
    const result = await this.run(profile, trusted.fingerprint, nodeCommand(SSH_CHECK), { signal });
    if (result.code !== 0)
      throw new ExecutionEnvironmentError(
        'SSH_PREREQUISITES',
        'The SSH host requires Linux, Node 22+ and Git on the remote login PATH. No sudo/install or Local fallback was attempted.'
      );
    const worker = await this.workerRecord(profile, trusted.fingerprint);
    const binding = projectPath
      ? await this.state.project(profile, trusted.fingerprint, await fs.realpath(projectPath))
      : undefined;
    if (binding?.ready) await this.verify(binding, signal);
    else if (worker)
      await this.verifyWorker(profile, trusted.fingerprint, worker, undefined, signal);
    return {
      status: 'available',
      checkedAt,
      hostKey,
      worker: worker ? 'ready' : 'not-tested',
      project: binding?.ready ? 'ready' : 'not-tested',
      ...(binding && { remotePath: binding.remotePath }),
      message: binding?.ready
        ? 'SSH worker and authoritative remote checkout verified.'
        : 'SSH authentication and Linux/Node/Git verified. Prepare the worker and project separately.',
    };
  }
  private async workerFile(profile: SSHEnvironmentProfile, fingerprint: string) {
    return path.join(
      this.state.directory,
      'workers',
      sshDigest(
        JSON.stringify([
          profile.host,
          profile.port,
          profile.username,
          profile.basePath,
          fingerprint,
        ])
      ) + '.json'
    );
  }
  private async workerRecord(profile: SSHEnvironmentProfile, fingerprint: string) {
    return readSSHState<Worker>(await this.workerFile(profile, fingerprint));
  }
  async prepareWorker(profile: SSHEnvironmentProfile, signal?: AbortSignal): Promise<Worker> {
    const trusted = await this.state.trust(profile);
    if (!trusted)
      throw new ExecutionEnvironmentError(
        'SSH_TRUST_REQUIRED',
        'Confirm the SSH fingerprint before preparing a worker.'
      );
    const file = await this.workerFile(profile, trusted.fingerprint);
    return sshSerialized(file, async () => {
      const stored = await this.workerRecord(profile, trusted.fingerprint);
      if (stored) {
        await this.verifyWorker(profile, trusted.fingerprint, stored, undefined, signal);
        if (stored.workerHash === SSH_WORKER_HASH) return stored;
      }
      const result = await this.run(profile, trusted.fingerprint, nodeCommand(SSH_INSTALL), {
        signal,
        input: JSON.stringify({
          basePath: profile.basePath,
          owner: await this.state.owner(),
          worker: SSH_WORKER,
          cancel: SSH_CANCEL,
          workerHash: SSH_WORKER_HASH,
          cancelHash: SSH_CANCEL_HASH,
        }),
      });
      if (result.code !== 0)
        throw new ExecutionEnvironmentError(
          'SSH_PREPARE_FAILED',
          'Remote worker preparation failed. Check Linux, Node 22+, Git, writable base directory and modified worker files. No Local fallback was performed.'
        );
      const worker = JSON.parse(result.stdout) as Worker;
      if (
        worker.workerHash !== SSH_WORKER_HASH ||
        worker.cancelHash !== SSH_CANCEL_HASH ||
        ![
          worker.basePath,
          worker.root,
          worker.workerPath,
          worker.cancelPath,
          worker.jobsDirectory,
        ].every(validPath)
      )
        throw new ExecutionEnvironmentError(
          'SSH_WORKER_CHANGED',
          'Invalid remote worker descriptor.'
        );
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await atomicWriteJson(file, worker, { mode: 0o600 });
      return worker;
    });
  }
  private verifyWorker(
    profile: SSHEnvironmentProfile,
    fingerprint: string,
    worker: Worker,
    project?: string,
    signal?: AbortSignal
  ) {
    return this.run(
      profile,
      fingerprint,
      nodeCommand(SSH_VERIFY, [
        worker.basePath,
        worker.identity,
        worker.workerPath,
        worker.workerHash,
        worker.cancelPath,
        worker.cancelHash,
        project ?? '',
      ]),
      { signal }
    ).then((result) => {
      if (result.code !== 0 || result.stdout !== 'verified')
        throw new ExecutionEnvironmentError(
          'SSH_WORKER_CHANGED',
          'Pinned SSH worker, OS user or project path changed. No migration or Local fallback was performed.'
        );
    });
  }
  async verify(binding: SSHProjectBinding, signal?: AbortSignal) {
    if (binding.owner !== (await this.state.owner()))
      throw new ExecutionEnvironmentError(
        'SSH_OWNER_CHANGED',
        'Pinned SSH environment belongs to a different installation.'
      );
    await this.verifyWorker(
      binding.profile,
      binding.fingerprint,
      {
        ...binding,
        basePath: binding.profile.basePath,
        root: path.posix.dirname(binding.jobsDirectory),
      },
      binding.remotePath,
      signal
    );
    await this.assertSettled(binding);
  }
  private journal(binding: SSHProjectBinding) {
    return path.join(
      this.state.directory,
      'jobs',
      this.state.projectKey(binding.profile, binding.fingerprint, binding.projectPath)
    );
  }
  private async jobs(binding: SSHProjectBinding): Promise<Job[]> {
    const directory = this.journal(binding);
    const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const result: Job[] = [];
    for (const name of names) {
      // atomicWriteJson may expose a temporary/backup file while another request writes.
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const job = await readSSHState<Job>(path.join(directory, name));
      if (job) result.push(job);
    }
    return result;
  }
  private async assertSettled(binding: SSHProjectBinding) {
    if (
      (await this.jobs(binding)).some((job) => job.status === 'unknown' || !activeJobs.has(job.id))
    )
      throw new ExecutionEnvironmentError(
        'SSH_OUTCOME_UNKNOWN',
        'A previous SSH operation has an unknown outcome. Inspect the remote checkout and acknowledge recovery in Project Settings; it will not be replayed.'
      );
  }
  async recover(binding: SSHProjectBinding, signal?: AbortSignal) {
    const jobs = await this.jobs(binding);
    for (const job of jobs) {
      if (activeJobs.has(job.id))
        throw new ExecutionEnvironmentError(
          'SSH_OPERATION_RUNNING',
          'Stop the active request before recovering SSH state.'
        );
      const result = await this.cancel(binding, job.id, signal, true);
      if (result.code !== 0)
        throw new ExecutionEnvironmentError(
          'SSH_CLEANUP_UNVERIFIED',
          'Remote completion could not be verified. Inspect/stop the remote processes before acknowledging recovery.'
        );
      await fs.unlink(path.join(this.journal(binding), job.id + '.json'));
    }
  }
  private cancel(binding: SSHProjectBinding, id: string, signal?: AbortSignal, recover = false) {
    return this.run(
      binding.profile,
      binding.fingerprint,
      nodeCommand(SSH_LOAD, [
        binding.cancelPath,
        binding.cancelHash,
        id,
        binding.jobsDirectory,
        recover ? 'recover' : '',
      ]),
      { signal, timeoutMs: 6000 }
    );
  }
  async rpc<T>(
    binding: SSHProjectBinding,
    cwd: string,
    operation: string,
    args: object,
    signal: AbortSignal,
    output?: EnvironmentProcessOutput
  ): Promise<T> {
    signal.throwIfAborted();
    await this.assertSettled(binding);
    const id = randomUUID();
    const file = path.join(this.journal(binding), id + '.json');
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const job: Job = { id, status: 'running', operation, cwd, createdAt: new Date().toISOString() };
    activeJobs.add(id);
    try {
      await atomicWriteJson(file, job, { mode: 0o600 });
    } catch (error) {
      activeJobs.delete(id);
      throw error;
    }
    const client = new AbortController();
    let cancellation: Promise<void> | undefined;
    let confirmed = false;
    let cleanupVerified = false;
    const cancel = () => {
      cancellation ??= this.cancel(binding, id)
        .then((result) => {
          if (result.code !== 0) throw new Error('unverified');
          cleanupVerified = true;
        })
        .finally(() => client.abort());
      void cancellation.catch(() => {});
    };
    const timeout =
      operation === 'process'
        ? Math.min((args as EnvironmentProcessRequest).timeoutMs ?? 600_000, 600_000) + 8000
        : operation === 'exec'
          ? Math.min(
              (args as { options?: { timeoutMs?: number } }).options?.timeoutMs ?? 180000,
              600000
            ) + 8000
          : 60000;
    signal.addEventListener('abort', cancel, { once: true });
    const stream = output ? new WorkerStream(output) : undefined;
    try {
      if (signal.aborted) signal.throwIfAborted();
      const result = await this.run(
        binding.profile,
        binding.fingerprint,
        nodeCommand(SSH_LOAD, [
          binding.workerPath,
          binding.workerHash,
          id,
          binding.jobsDirectory,
          '',
          cwd,
        ]),
        {
          input: JSON.stringify({ operation, args }),
          signal: client.signal,
          timeoutMs: timeout,
          // Worker output may expand up to 6x when JSON escapes control bytes.
          maximum: stream ? 48 * 1024 * 1024 : 8 * 1024 * 1024,
          onStdout: stream?.push,
        }
      );
      if (result.code === 72) {
        confirmed = true;
        throw new ExecutionEnvironmentError(
          'SSH_WORKER_CHANGED',
          'Pinned SSH worker or cwd is unavailable/changed. No agent operation was executed.'
        );
      }
      if (result.code !== 0) {
        cancel();
        throw new ExecutionEnvironmentError(
          'SSH_OUTCOME_UNKNOWN',
          'SSH worker failed or disconnected. Inspect the remote result; no operation was replayed.'
        );
      }
      if (signal.aborted) {
        confirmed = true;
        throw new ExecutionEnvironmentError(
          'PROCESS_INTERRUPTED',
          'SSH operation interrupted; prior effects are not rolled back.'
        );
      }
      const response = JSON.parse(stream ? stream.finish() : result.stdout) as {
        ok: boolean;
        value: T;
        error?: { code: string; message: string };
      };
      confirmed = true;
      if (!response.ok)
        throw new ExecutionEnvironmentError(
          response.error?.code ?? 'ENVIRONMENT_IO_ERROR',
          response.error?.message ?? 'Remote operation failed.'
        );
      return response.value;
    } catch (error) {
      if (error instanceof SSHTransportError && !error.dispatched) confirmed = true;
      else if (!confirmed) cancel();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      let cleanupFailed = false;
      try {
        await cancellation;
      } catch {
        cleanupFailed = true;
      }
      activeJobs.delete(id);
      if ((confirmed || (signal.aborted && cleanupVerified)) && !cleanupFailed)
        await fs.unlink(file);
      else await atomicWriteJson(file, { ...job, status: 'unknown' }, { mode: 0o600 });
      if (cleanupFailed)
        await Promise.reject(
          new ExecutionEnvironmentError(
            'SSH_OUTCOME_UNKNOWN',
            'SSH cleanup/result could not be verified. The project is blocked until explicit recovery; no commands were replayed.'
          )
        );
    }
  }
  async prepareProject(
    profile: SSHEnvironmentProfile,
    projectPath: string,
    source: SSHProjectSource,
    signal: AbortSignal
  ): Promise<SSHProjectBinding> {
    // Reject invalid/secret-bearing URLs before preparing or touching a remote checkout.
    if (source.method === 'clone') {
      let url: URL;
      try {
        url = new URL(source.repositoryUrl);
      } catch {
        throw new ExecutionEnvironmentError(
          'SSH_INVALID_REPOSITORY',
          'Use an HTTPS or ssh:// repository URL without embedded secrets, query or fragment.'
        );
      }
      if (
        !['https:', 'ssh:'].includes(url.protocol) ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === 'https:' && url.username) ||
        /[\x00-\x1f\x7f]/.test(source.repositoryUrl)
      )
        throw new ExecutionEnvironmentError(
          'SSH_INVALID_REPOSITORY',
          'Use an HTTPS or ssh:// repository URL without embedded secrets, query or fragment.'
        );
    }
    projectPath = await fs.realpath(projectPath);
    const worker = await this.prepareWorker(profile, signal);
    const trusted = (await this.state.trust(profile))!;
    const file = this.state.projectFile(profile, trusted.fingerprint, projectPath);
    return sshSerialized(file, async () => {
      const stored = await this.state.project(profile, trusted.fingerprint, projectPath);
      if (stored?.ready) {
        await this.verify({ ...stored, profile }, signal);
        await this.assertSettled(stored);
        // Explicit preparation upgrades the worker for NEW bindings only, not pinned runs.
        const upgraded = {
          ...stored,
          profile,
          workerPath: worker.workerPath,
          workerHash: worker.workerHash,
          cancelPath: worker.cancelPath,
          cancelHash: worker.cancelHash,
        };
        await this.state.saveProject(upgraded);
        return upgraded;
      }
      const owner = await this.state.owner();
      const remotePath =
        source.method === 'existing'
          ? source.remotePath
          : path.posix.join(worker.root, 'projects', sshDigest(projectPath).slice(0, 24));
      if (
        !validPath(remotePath) ||
        remotePath === worker.root ||
        worker.root.startsWith(remotePath + '/')
      )
        throw new ExecutionEnvironmentError(
          'SSH_INVALID_PATH',
          'Choose an absolute, dedicated remote checkout path, not the worker state directory or its parent.'
        );
      const binding: SSHProjectBinding = {
        version: 1,
        ready: false,
        owner,
        profile: JSON.parse(JSON.stringify(profile)),
        fingerprint: trusted.fingerprint,
        identity: worker.identity,
        projectPath,
        remotePath,
        workerPath: worker.workerPath,
        workerHash: worker.workerHash,
        cancelPath: worker.cancelPath,
        cancelHash: worker.cancelHash,
        jobsDirectory: worker.jobsDirectory,
      };
      await this.assertSettled(binding);
      await this.state.saveProject(binding);
      const environment = new SSHExecutionEnvironment(this, binding, worker.basePath);
      const command = async (value: string) => {
        const result = await environment.exec(value, signal, { timeoutMs: 600000 });
        if (result.exitCode !== 0)
          throw new ExecutionEnvironmentError(
            'SSH_PROJECT_PREPARE_FAILED',
            'Remote checkout preparation failed. Existing files were not overwritten; inspect Git access, permissions and any staging directory before retrying.'
          );
        return result;
      };
      if (source.method !== 'existing') {
        const staging = remotePath + '.preparing-' + randomUUID();
        binding.preparationPath = staging;
        await this.state.saveProject(binding);
        await command(
          `mkdir -p -- ${shellQuote(path.posix.dirname(remotePath))} && test ! -e ${shellQuote(remotePath)} && mkdir -- ${shellQuote(staging)}`
        );
        if (source.method === 'clone') {
          await command(
            `git -c protocol.ext.allow=never clone -- ${shellQuote(source.repositoryUrl)} ${shellQuote(staging)}`
          );
        } else
          await this.importProject(profile, binding, projectPath, staging, environment, signal);
        await command(
          `test ! -e ${shellQuote(remotePath)} && mv -T -- ${shellQuote(staging)} ${shellQuote(remotePath)}`
        );
      }
      const check = await environment.exec(
        `test "$(git -C ${shellQuote(remotePath)} rev-parse --show-toplevel)" = ${shellQuote(remotePath)} && git -C ${shellQuote(remotePath)} rev-parse --verify HEAD >/dev/null && test -w ${shellQuote(remotePath)} && test -z "$(git -C ${shellQuote(remotePath)} status --porcelain)"`,
        signal
      );
      if (check.exitCode !== 0)
        throw new ExecutionEnvironmentError(
          'SSH_PROJECT_PREPARE_FAILED',
          'Choose a clean, writable Git repository root with an initial commit (not a symlink). Commit or stash existing remote changes first; they were not discarded.'
        );
      binding.ready = true;
      delete binding.preparationPath;
      await this.state.saveProject(binding);
      return binding;
    });
  }
  private async importProject(
    profile: SSHEnvironmentProfile,
    binding: SSHProjectBinding,
    local: string,
    staging: string,
    environment: SSHExecutionEnvironment,
    signal: AbortSignal
  ) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-ssh-import-'));
    const git = (args: string[]) =>
      execFileAsync('git', ['-C', local, ...args], { signal, maxBuffer: 1024 * 1024 });
    let bundle: string | undefined;
    try {
      try {
        await git(['rev-parse', '--verify', 'HEAD']);
        bundle = path.join(temporary, 'project.bundle');
        await git(['bundle', 'create', bundle, '--all', 'HEAD']);
      } catch (error) {
        if (signal.aborted) throw error;
        if (bundle)
          throw new ExecutionEnvironmentError(
            'SSH_IMPORT_FAILED',
            'Local Git bundle could not be created. No existing remote checkout was replaced.'
          );
      }
      const config = await this.state.configuration(profile, binding.fingerprint);
      const client = await connectSSH(config, signal);
      try {
        const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) =>
          client.sftp((error, value) => (error ? reject(error) : resolve(value)))
        );
        const put = (source: string, target: string) =>
          new Promise<void>((resolve, reject) => {
            const input = createReadStream(source);
            const output = sftp.createWriteStream(target, { flags: 'wx', mode: 0o600 });
            const stop = () => {
              input.destroy();
              output.destroy();
              reject(
                new ExecutionEnvironmentError(
                  'SSH_IMPORT_INTERRUPTED',
                  'Initial transfer interrupted. Only the new staging checkout may be partial; no synchronization or replay was performed.'
                )
              );
            };
            signal.addEventListener('abort', stop, { once: true });
            input.on('error', reject);
            output.on('error', reject);
            output.on('close', () => {
              signal.removeEventListener('abort', stop);
              resolve();
            });
            input.pipe(output);
          });
        if (bundle) {
          const remoteBundle = staging + '.bundle';
          await put(bundle, remoteBundle);
          const result = await environment.exec(
            `git clone -- ${shellQuote(remoteBundle)} ${shellQuote(staging)} && git -C ${shellQuote(staging)} remote remove origin && rm -- ${shellQuote(remoteBundle)}`,
            signal,
            { timeoutMs: 600000 }
          );
          if (result.exitCode !== 0)
            throw new ExecutionEnvironmentError(
              'SSH_IMPORT_FAILED',
              'Remote Git bundle clone failed. Inspect the new staging checkout.'
            );
        } else {
          const result = await environment.exec(`git init -- ${shellQuote(staging)}`, signal);
          if (result.exitCode !== 0)
            throw new ExecutionEnvironmentError(
              'SSH_IMPORT_FAILED',
              'Remote Git initialization failed.'
            );
        }
        const mkdir = (directory: string, mode: number) =>
          new Promise<void>((resolve, reject) =>
            sftp.mkdir(directory, { mode }, (error) => (error ? reject(error) : resolve()))
          );
        const chmod = (file: string, mode: number) =>
          new Promise<void>((resolve, reject) =>
            sftp.chmod(file, mode, (error) => (error ? reject(error) : resolve()))
          );
        const unlink = (file: string) =>
          new Promise<void>((resolve, reject) =>
            sftp.unlink(file, (error) => (error ? reject(error) : resolve()))
          );
        const overlay = async (directory: string, relative = '') => {
          for await (const entry of await fs.opendir(directory)) {
            signal.throwIfAborted();
            if (['.git', '.worktrees', '.automaker', 'node_modules'].includes(entry.name)) continue;
            const sourceFile = path.join(directory, entry.name);
            const remoteFile = path.posix.join(staging, relative, entry.name);
            const stat = await fs.lstat(sourceFile);
            if (stat.isDirectory()) {
              await mkdir(remoteFile, stat.mode & 0o777).catch(async () => {
                const result = await environment.exec(
                  `test ! -L ${shellQuote(remoteFile)} && test -d ${shellQuote(remoteFile)}`,
                  signal
                );
                if (result.exitCode !== 0)
                  throw new ExecutionEnvironmentError(
                    'SSH_IMPORT_FAILED',
                    'Remote directory conflict during import.'
                  );
              });
              await overlay(sourceFile, path.posix.join(relative, entry.name));
            } else if (stat.isFile()) {
              await unlink(remoteFile).catch(() => {});
              await put(sourceFile, remoteFile);
              await chmod(remoteFile, stat.mode & 0o777);
            } else if (stat.isSymbolicLink()) {
              const target = await fs.readlink(sourceFile);
              const resolved = path.resolve(path.dirname(sourceFile), target);
              if (
                path.isAbsolute(target) ||
                (!resolved.startsWith(local + path.sep) && resolved !== local)
              )
                throw new ExecutionEnvironmentError(
                  'SSH_IMPORT_FAILED',
                  'Initial transfer refuses absolute or project-external symlinks; prepare such a checkout remotely instead.'
                );
              await unlink(remoteFile).catch(() => {});
              await new Promise<void>((resolve, reject) =>
                sftp.symlink(target, remoteFile, (error) => (error ? reject(error) : resolve()))
              );
            } else
              throw new ExecutionEnvironmentError(
                'SSH_IMPORT_FAILED',
                'Initial transfer does not copy sockets, devices or special files.'
              );
          }
        };
        await overlay(local);
        // Git bundle creates the committed tree. Apply local tracked deletions as well.
        if (bundle) {
          const removed = await git(['ls-files', '--deleted', '-z']);
          for (const name of removed.stdout.split('\0').filter(Boolean)) {
            if (
              name.split('/').some((part) => part === '..' || part === '.git') ||
              path.posix.isAbsolute(name)
            )
              throw new ExecutionEnvironmentError('SSH_IMPORT_FAILED', 'Invalid deleted Git path.');
            await unlink(path.posix.join(staging, name)).catch(() => {});
          }
        }
        const snapshot = await environment.exec(
          `git -C ${shellQuote(staging)} checkout -b ${shellQuote('automaker/import-' + randomUUID())} && git -C ${shellQuote(staging)} -c core.hooksPath=/dev/null add -A --force . && git -C ${shellQuote(staging)} -c core.hooksPath=/dev/null -c user.name=Automaker -c user.email=automaker@localhost -c commit.gpgSign=false commit --allow-empty -m 'Initial SSH workspace snapshot (no push)'`,
          signal,
          { timeoutMs: 600000 }
        );
        if (snapshot.exitCode !== 0)
          throw new ExecutionEnvironmentError(
            'SSH_IMPORT_FAILED',
            'Initial snapshot commit failed. Inspect the new staging directory.'
          );
      } finally {
        client.end();
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async bind(
    profile: SSHEnvironmentProfile,
    projectPath: string,
    key: string,
    relative: string,
    signal?: AbortSignal,
    feature?: { targetBranch?: string | null }
  ) {
    const trusted = await this.state.trust(profile);
    if (!trusted)
      throw new ExecutionEnvironmentError(
        'SSH_TRUST_REQUIRED',
        'Confirm the SSH host fingerprint and explicitly prepare the remote checkout in Project Settings. No Local fallback was performed.'
      );
    const stored = await this.state.project(profile, trusted.fingerprint, projectPath);
    if (!stored?.ready)
      throw new ExecutionEnvironmentError(
        'SSH_PROJECT_REQUIRED',
        'Prepare an authoritative remote checkout in Project Settings before starting SSH execution. No implicit copy or Local fallback was performed.'
      );
    const binding = { ...stored, profile: JSON.parse(JSON.stringify(profile)) };
    await this.verify(binding, signal);
    const branch = `automaker/run-${sshDigest(key).slice(0, 24)}`;
    const cwd = path.posix.join(binding.remotePath, '.worktrees', sshDigest(key).slice(0, 24));
    const environment = new SSHExecutionEnvironment(this, binding, binding.remotePath);
    let workspace: SSHFeatureWorkspace | undefined;
    if (feature) {
      const intent = path.join(
        this.state.directory,
        'feature-workspaces',
        this.state.projectKey(profile, binding.fingerprint, projectPath),
        sshDigest(key) + '.json'
      );
      workspace = await sshSerialized(intent, async () => {
        const stored = await readSSHState<SSHFeatureWorkspace>(intent);
        if (stored) {
          if (
            stored.version !== 1 ||
            stored.branch !== branch ||
            (feature.targetBranch && stored.baseBranch !== feature.targetBranch)
          )
            throw new ExecutionEnvironmentError(
              'SSH_WORKSPACE_CHANGED',
              'Pinned feature branch intent does not match. No automatic migration was performed.'
            );
          return stored;
        }
        const source = await environment.exec(
          nodeCommand(
            String.raw`
const {execFileSync}=require('node:child_process');
try {
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const branch=process.argv[1]||git('symbolic-ref','--quiet','--short','HEAD');
 git('check-ref-format','refs/heads/'+branch);
 const commit=git('rev-parse','--verify','refs/heads/'+branch+'^{commit}');
 process.stdout.write(JSON.stringify({branch,commit}));
}catch{process.exitCode=1;}
`,
            [feature.targetBranch ?? '']
          ),
          signal ?? new AbortController().signal
        );
        if (source.exitCode !== 0 || source.truncated)
          throw new ExecutionEnvironmentError(
            'SSH_BRANCH_REQUIRED',
            'Select an existing remote local branch (not a remote-tracking ref or detached HEAD). No local Git lookup or branch fallback was performed.'
          );
        const base = JSON.parse(source.output) as { branch: string; commit: string };
        if (!/^[a-f0-9]{40,64}$/.test(base.commit))
          throw new ExecutionEnvironmentError(
            'SSH_WORKSPACE_CHANGED',
            'Invalid remote base commit.'
          );
        const value: SSHFeatureWorkspace = {
          version: 1,
          branch,
          baseBranch: base.branch,
          baseCommit: base.commit,
        };
        // Persist base BEFORE worktree creation: an ambiguous attempt must not rebase on retry.
        await fs.mkdir(path.dirname(intent), { recursive: true, mode: 0o700 });
        await atomicWriteJson(intent, value, { mode: 0o600 });
        return value;
      });
    }
    const target = shellQuote(cwd),
      root = shellQuote(binding.remotePath),
      ref = shellQuote(branch);
    const result = await environment.exec(
      `if test -d ${target}; then test "$(git -C ${target} symbolic-ref --short HEAD)" = ${ref}; else mkdir -p -- ${shellQuote(path.posix.dirname(cwd))} && git -c core.hooksPath=/dev/null -C ${root} worktree add -b ${ref} -- ${target}${workspace ? ' ' + shellQuote(workspace.baseCommit) : ''}; fi`,
      signal ?? new AbortController().signal
    );
    if (result.exitCode !== 0)
      throw new ExecutionEnvironmentError(
        'SSH_WORKTREE_FAILED',
        'Remote run worktree could not be created/verified. No Local fallback was performed.'
      );
    const runtimeCwd = path.posix.join(cwd, relative.split(path.sep).join('/'));
    const check = await environment.exec(
      `test -d ${shellQuote(runtimeCwd)}`,
      signal ?? new AbortController().signal
    );
    if (check.exitCode !== 0)
      throw new ExecutionEnvironmentError(
        'SSH_CWD_MISSING',
        'The selected relative directory does not exist in the authoritative remote checkout.'
      );
    if (workspace) await this.verifyWorkspace(binding, runtimeCwd, workspace, signal);
    return { binding, runtimeCwd, workspace };
  }
  async verifyWorkspace(
    binding: SSHProjectBinding,
    cwd: string,
    workspace: SSHFeatureWorkspace,
    signal?: AbortSignal
  ) {
    const environment = new SSHExecutionEnvironment(this, binding, cwd);
    const result = await environment.exec(
      nodeCommand(
        String.raw`
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
try {
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(fs.realpathSync(process.cwd())!==process.cwd()||git('symbolic-ref','--quiet','--short','HEAD')!==process.argv[1]||
    fs.realpathSync(path.resolve(git('rev-parse','--git-common-dir')))!==fs.realpathSync(path.join(process.argv[2],'.git')))throw Error();
}catch{process.exitCode=1;}
`,
        [workspace.branch, binding.remotePath]
      ),
      signal ?? new AbortController().signal
    );
    if (result.exitCode !== 0)
      throw new ExecutionEnvironmentError(
        'SSH_WORKSPACE_CHANGED',
        'Pinned remote feature branch/worktree no longer matches. No local fallback or automatic branch switch was performed.'
      );
  }
}

export class SSHExecutionEnvironment implements ExecutionEnvironment {
  readonly type = 'ssh' as const;
  readonly platform = 'linux' as const;
  readonly capabilities = Object.freeze({
    shell: true,
    binaryFiles: true,
    remove: true,
    sandboxed: false,
  });
  constructor(
    private readonly manager: ManagedSSH,
    readonly binding: SSHProjectBinding,
    readonly cwd: string
  ) {}
  async readFile(file: string, offset: number, length: number, signal: AbortSignal) {
    const result = await this.manager.rpc<{ data: string; size: number }>(
      this.binding,
      this.cwd,
      'read',
      { path: file, offset, length },
      signal
    );
    return { data: Buffer.from(result.data, 'base64'), size: result.size };
  }
  writeFile(file: string, data: Buffer, signal: AbortSignal, expectedSha256?: string | null) {
    return this.manager.rpc<void>(
      this.binding,
      this.cwd,
      'write',
      { path: file, data: data.toString('base64'), expectedSha256 },
      signal
    );
  }
  listDirectory(directory: string, maximum: number, signal: AbortSignal) {
    return this.manager.rpc<{ entries: EnvironmentEntry[]; truncated: boolean }>(
      this.binding,
      this.cwd,
      'list',
      { path: directory, maximum },
      signal
    );
  }
  mkdir(directory: string, signal: AbortSignal) {
    return this.manager.rpc<void>(this.binding, this.cwd, 'mkdir', { path: directory }, signal);
  }
  remove(target: string, recursive: boolean, signal: AbortSignal) {
    return this.manager.rpc<void>(
      this.binding,
      this.cwd,
      'remove',
      { path: target, recursive },
      signal
    );
  }
  search(options: EnvironmentSearchOptions, signal: AbortSignal) {
    return this.manager.rpc<EnvironmentSearchResult>(
      this.binding,
      this.cwd,
      'search',
      options,
      signal
    );
  }
  exec(
    command: string,
    signal: AbortSignal,
    options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }
  ) {
    return this.manager.rpc<EnvironmentCommandResult>(
      this.binding,
      this.cwd,
      'exec',
      { command, options },
      signal
    );
  }
  runProcess(
    request: EnvironmentProcessRequest,
    signal: AbortSignal,
    output: EnvironmentProcessOutput
  ) {
    if (this.binding.workerHash !== SSH_WORKER_HASH)
      throw new ExecutionEnvironmentError(
        'SSH_WORKER_UPGRADE_REQUIRED',
        'This run uses an older SSH worker without streaming. Prepare the SSH project again and start a new session/feature. Existing runs are not retargeted.'
      );
    return this.manager.rpc<{ exitCode: number }>(
      this.binding,
      this.cwd,
      'process',
      request,
      signal,
      output
    );
  }
}
