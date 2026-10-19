import { spawn } from 'node:child_process';
import { ExecutionEnvironmentError } from './runtime.js';

export interface DockerResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type DockerRunner = (
  args: string[],
  options?: {
    input?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maximum?: number;
    onStdout?: (data: Buffer) => void;
  }
) => Promise<DockerResult>;

/** Killing this client does NOT cancel docker exec remotely. DockerEnvironment handles that. */
export const runDocker: DockerRunner = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    signal.throwIfAborted();
    const child = spawn('docker', args, {
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
    let bytes = 0;
    let failure: Error | undefined;
    const stop = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Already stopped. */
      }
    };
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream].on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > (options.maximum ?? 4 * 1024 * 1024)) {
          failure = new ExecutionEnvironmentError(
            'DOCKER_OUTPUT_LIMIT',
            'Docker response exceeded the transport limit. Inspect state before retrying.'
          );
          stop();
        } else if (stream === 'stdout' && options.onStdout) {
          try {
            options.onStdout(chunk);
          } catch (error) {
            failure = error instanceof Error ? error : new Error('Stream consumer failed.');
            stop();
          }
        } else chunks[stream].push(chunk);
      });
    }
    child.on('error', () => {
      failure = new ExecutionEnvironmentError(
        'DOCKER_CLIENT_FAILED',
        'Docker CLI could not start. Check the server installation.'
      );
    });
    // EPIPE is expected when Docker rejects a request before consuming stdin.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (failure) reject(failure);
      else if (signal.aborted)
        reject(
          new ExecutionEnvironmentError(
            'DOCKER_INTERRUPTED',
            'Docker client interrupted or timed out. The remote result may be unknown; do not automatically replay commands.'
          )
        );
      else
        resolve({
          code,
          stdout: Buffer.concat(chunks.stdout).toString('utf8'),
          stderr: Buffer.concat(chunks.stderr).toString('utf8'),
        });
    });
  });

export function dockerArguments(context: string | undefined, args: string[]): string[] {
  if (context !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(context))
    throw new ExecutionEnvironmentError('INVALID_CONTEXT', 'Invalid saved Docker context.');
  return [...(context ? ['--context', context] : []), ...args];
}

export async function dockerJson<T>(
  runner: DockerRunner,
  context: string | undefined,
  args: string[],
  signal?: AbortSignal
): Promise<T> {
  const result = await runner(dockerArguments(context, args), { signal });
  if (result.code !== 0)
    throw new ExecutionEnvironmentError(
      'DOCKER_REQUEST_FAILED',
      'Docker request failed. Check Engine permissions, context and resource state in Execution Environment settings.'
    );
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new ExecutionEnvironmentError(
      'DOCKER_RESPONSE_INVALID',
      'Docker returned an invalid response.'
    );
  }
}
