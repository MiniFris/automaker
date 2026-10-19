import ssh2, { type Client, type ConnectConfig, type SyncHostVerifier } from 'ssh2';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { ExecutionEnvironmentError } from './runtime.js';

export const sshFingerprint = (key: Buffer) =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function nodeCommand(source: string, args: string[] = []) {
  return ['node', '-e', source, ...args].map(shellQuote).join(' ');
}
export interface SSHCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface SSHCommandOptions {
  input?: string | Buffer | Readable;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximum?: number;
  onStdout?: (data: Buffer) => void;
}
export class SSHTransportError extends ExecutionEnvironmentError {
  constructor(
    code: string,
    message: string,
    readonly dispatched = false
  ) {
    super(code, message);
  }
}
export function connectSSH(config: ConnectConfig, signal?: AbortSignal): Promise<Client> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const client = new ssh2.Client();
    let hostRejected = false;
    const stop = () => {
      client.destroy();
      reject(
        new SSHTransportError(
          'SSH_CONNECTION_FAILED',
          'SSH connection was cancelled before execution.'
        )
      );
    };
    const cleanup = () => signal?.removeEventListener('abort', stop);
    client.once('ready', () => {
      cleanup();
      resolve(client);
    });
    client.once('error', (error) => {
      cleanup();
      reject(
        new SSHTransportError(
          hostRejected ? 'SSH_HOST_KEY_CHANGED' : 'SSH_CONNECTION_FAILED',
          hostRejected
            ? 'SSH host fingerprint does not match the confirmed key. No authentication or Local fallback was performed.'
            : error.level === 'client-authentication'
              ? 'SSH authentication failed. Configure a private key or the server ssh-agent.'
              : 'SSH connection/host verification failed. Check the host fingerprint, network, port and user.'
        )
      );
    });
    client.once('close', () => {
      cleanup();
      reject(
        new SSHTransportError(
          'SSH_CONNECTION_FAILED',
          'SSH connection closed before authentication completed.'
        )
      );
    });
    // Keep an error listener after readiness; individual commands also monitor the connection.
    client.on('error', () => {});
    signal?.addEventListener('abort', stop, { once: true });
    client.connect({
      readyTimeout: 8000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 2,
      ...config,
      ...(config.hostVerifier && {
        hostVerifier: (raw: Buffer) => {
          const accepted = (config.hostVerifier as SyncHostVerifier)(raw);
          hostRejected = !accepted;
          return accepted;
        },
      }),
    });
    if (signal?.aborted) stop();
  });
}

/** A channel/connection error after dispatch never authorizes a retry or Local fallback. */
export function execSSH(
  client: Client,
  command: string,
  options: SSHCommandOptions = {}
): Promise<SSHCommandResult> {
  return new Promise((resolve, reject) => {
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    signal.throwIfAborted();
    let settled = false;
    const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
    let bytes = 0;
    const finish = (error?: Error, value?: SSHCommandResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', stop);
      client.off('error', lost);
      client.off('close', lost);
      if (error) reject(error);
      else resolve(value!);
    };
    const lost = () =>
      finish(
        new SSHTransportError(
          'SSH_OUTCOME_UNKNOWN',
          'SSH disconnected after dispatch. The remote result is unknown; do not replay the operation.',
          true
        )
      );
    const stop = () => {
      lost();
      client.destroy();
    };
    client.on('error', lost);
    client.on('close', lost);
    signal.addEventListener('abort', stop, { once: true });
    client.exec(command, (error, channel) => {
      if (error) {
        finish(
          new SSHTransportError('SSH_EXEC_REJECTED', 'SSH server rejected command execution.')
        );
        return;
      }
      if (settled) {
        channel.close();
        return;
      }
      for (const name of ['stdout', 'stderr'] as const) {
        const stream = name === 'stdout' ? channel : channel.stderr;
        stream.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > (options.maximum ?? 4 * 1024 * 1024)) {
            finish(
              new SSHTransportError(
                'SSH_OUTCOME_UNKNOWN',
                'SSH output exceeded the transport budget. Inspect the remote result before continuing.',
                true
              )
            );
            client.destroy();
          } else if (name === 'stdout' && options.onStdout) {
            try {
              options.onStdout(chunk);
            } catch (error) {
              finish(error instanceof Error ? error : new Error('Stream consumer failed.'));
              client.destroy();
            }
          } else chunks[name].push(Buffer.from(chunk));
        });
      }
      channel.on('error', lost);
      channel.on('close', (code: number | undefined) => {
        if (!Number.isInteger(code)) {
          lost();
          return;
        }
        finish(undefined, {
          code: code!,
          stdout: Buffer.concat(chunks.stdout).toString('utf8'),
          stderr: Buffer.concat(chunks.stderr).toString('utf8'),
        });
      });
      channel.on('error', () => {});
      if (options.input && typeof options.input === 'object' && 'pipe' in options.input) {
        options.input.once('error', stop);
        options.input.pipe(channel);
        channel.once('close', () => {
          (options.input as Readable).off('error', stop);
          (options.input as Readable).destroy();
        });
      } else channel.end(options.input ?? '');
    });
    if (signal.aborted) stop();
  });
}
