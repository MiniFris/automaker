import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { waitForLinuxProcessGroupExit } from '../../core/platform/linux-process-group.js';
import {
  ExecutionEnvironmentError,
  type ExecutionEnvironment,
  type EnvironmentCommandResult,
  type EnvironmentEntry,
} from './runtime.js';

const writes = new Map<string, Promise<void>>();

/** Preserve legacy node:child_process.exec cmd semantics only for explicit callers. */
export function localShellInvocation(
  command: string,
  platform: NodeJS.Platform,
  windowsShell?: 'cmd',
  comspec = process.env.comspec ?? process.env.ComSpec
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== 'win32') return { command: '/bin/sh', args: ['-c', command] };
  if (windowsShell === 'cmd') {
    const shell = comspec || 'cmd.exe';
    return /^(?:.*\\)?cmd(?:\.exe)?$/i.test(shell)
      ? { command: shell, args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true }
      : { command: shell, args: ['-c', command] };
  }
  return {
    command: 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' + command,
    ],
  };
}

/** Not a sandbox. Explicit consent grants the normal filesystem/process rights of Automaker. */
export class LocalExecutionEnvironment implements ExecutionEnvironment {
  readonly type = 'local' as const;
  readonly platform = process.platform;
  readonly capabilities = Object.freeze({
    shell: true,
    binaryFiles: true,
    remove: true,
    sandboxed: false,
  });
  private constructor(readonly cwd: string) {}
  static async create(cwd: string): Promise<LocalExecutionEnvironment> {
    const absolute = await fs.realpath(cwd);
    if (!(await fs.stat(absolute)).isDirectory())
      throw new ExecutionEnvironmentError('INVALID_CWD', 'Working directory must exist.');
    return new LocalExecutionEnvironment(absolute);
  }
  private resolve(target: string): string {
    if (!target || /\0/.test(target))
      throw new ExecutionEnvironmentError('INVALID_PATH', 'Invalid file path.');
    return path.resolve(this.cwd, target);
  }
  async readFile(file: string, offset: number, length: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > 2 * 1024 * 1024
    )
      throw new ExecutionEnvironmentError(
        'INVALID_RANGE',
        'Read at most 2 MiB per call; use offsets for larger files.'
      );
    const handle = await fs.open(
      this.resolve(file),
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new ExecutionEnvironmentError('NOT_A_FILE', 'Read requires a regular file.');
      const data = Buffer.alloc(Math.min(length, Math.max(0, stat.size - offset)));
      let count = 0;
      while (count < data.length) {
        signal.throwIfAborted();
        const result = await handle.read(
          data,
          count,
          Math.min(65_536, data.length - count),
          offset + count
        );
        if (!result.bytesRead) break;
        count += result.bytesRead;
      }
      signal.throwIfAborted();
      return { data: data.subarray(0, count), size: stat.size };
    } finally {
      await handle.close();
    }
  }
  async writeFile(
    file: string,
    data: Buffer,
    signal: AbortSignal,
    expectedSha256?: string | null
  ): Promise<void> {
    const requested = this.resolve(file);
    // Follow an existing symlink deliberately: Local is not a path-confinement boundary.
    const target = await fs.realpath(requested).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return requested;
    });
    const previous = writes.get(target) ?? Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        signal.throwIfAborted();
        await fs.mkdir(path.dirname(target), { recursive: true });
        const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (stat && !stat.isFile())
          throw new ExecutionEnvironmentError('NOT_A_FILE', 'Write requires a regular file.');
        if ((expectedSha256 === null && stat) || (typeof expectedSha256 === 'string' && !stat))
          throw new ExecutionEnvironmentError(
            'FILE_CONFLICT',
            'File changed; read it again before writing.'
          );
        if (typeof expectedSha256 === 'string') {
          const hasher = createHash('sha256');
          for await (const chunk of createReadStream(target, { signal })) {
            signal.throwIfAborted();
            hasher.update(chunk);
          }
          if (hasher.digest('hex') !== expectedSha256)
            throw new ExecutionEnvironmentError(
              'FILE_CONFLICT',
              'File changed; read it again before writing.'
            );
        }
        const temporary = path.join(path.dirname(target), `.automaker-local-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, data, {
            flag: 'wx',
            mode: stat ? stat.mode & 0o777 : 0o644,
            signal,
          });
          signal.throwIfAborted();
          // Normal editor semantics, not a filesystem transaction or cross-process compare-and-swap.
          await fs.rename(temporary, target);
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
      });
    writes.set(target, operation);
    try {
      await operation;
    } finally {
      if (writes.get(target) === operation) writes.delete(target);
    }
  }
  async listDirectory(directory: string, maximum: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const handle = await fs.opendir(this.resolve(directory));
    const entries: EnvironmentEntry[] = [];
    let truncated = false;
    try {
      for await (const entry of handle) {
        signal.throwIfAborted();
        if (entries.length >= maximum) {
          truncated = true;
          break;
        }
        entries.push({
          name: entry.name,
          type: entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : entry.isSymbolicLink()
                ? 'symlink'
                : 'other',
        });
      }
    } finally {
      await handle.close().catch(() => {});
    }
    return { entries, truncated };
  }
  async mkdir(directory: string, signal: AbortSignal) {
    signal.throwIfAborted();
    await fs.mkdir(this.resolve(directory), { recursive: true });
  }
  async remove(target: string, recursive: boolean, signal: AbortSignal) {
    signal.throwIfAborted();
    const file = this.resolve(target);
    if (file === path.parse(file).root)
      throw new ExecutionEnvironmentError(
        'INVALID_PATH',
        'Use an explicit non-root removal target.'
      );
    await fs.rm(file, { recursive, force: false });
  }
  async exec(
    command: string,
    signal: AbortSignal,
    options: {
      cwd?: string;
      timeoutMs?: number;
      maxOutputBytes?: number;
      windowsShell?: 'cmd';
    } = {}
  ): Promise<EnvironmentCommandResult> {
    signal.throwIfAborted();
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 180_000);
    const combined = AbortSignal.any([signal, deadline]);
    const cwd = options.cwd ? this.resolve(options.cwd) : this.cwd;
    const windows = process.platform === 'win32';
    const invocation = localShellInvocation(command, process.platform, options.windowsShell);
    const maximum = Math.min(options.maxOutputBytes ?? 12_000, 1_048_576);
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd,
        env: { ...process.env },
        detached: !windows,
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      let failure: Error | undefined;
      let exited = false;
      let cleanup: Promise<void> | undefined;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanupDeadline: number | undefined;
      const cleanupController = new AbortController();
      const stop = () => {
        if (cleanup) return;
        cleanupDeadline = performance.now() + 2000;
        cleanupTimer = setTimeout(() => {
          cleanupController.abort();
          combined.removeEventListener('abort', stop);
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          reject(
            new ExecutionEnvironmentError(
              'PROCESS_CLEANUP_FAILED',
              'Local process cleanup could not be verified. Inspect running processes before retrying.'
            )
          );
        }, 2000);
        cleanup = windows
          ? new Promise<void>((done) => {
              if (!child.pid || exited) {
                done();
                return;
              }
              const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
                windowsHide: true,
                stdio: 'ignore',
                timeout: 1500,
              });
              killer.once('error', () => {
                child.kill('SIGKILL');
                done();
              });
              killer.once('close', () => done());
            })
          : Promise.resolve().then(async () => {
              if (!child.pid) return;
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
              }
              if (process.platform === 'linux')
                await waitForLinuxProcessGroupExit(child.pid, cleanupController.signal);
            });
        // Cleanup failures are awaited and reported by the close handler, never unhandled rejections.
        void cleanup.catch(() => {});
      };
      const consume = (chunk: Buffer) => {
        const remaining = Math.max(0, maximum - bytes);
        if (chunk.length > remaining) truncated = true;
        if (remaining) chunks.push(chunk.subarray(0, remaining));
        bytes += Math.min(chunk.length, remaining);
      };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
      child.once('error', (error) => {
        failure = error;
      });
      child.once('exit', () => {
        exited = true;
        // A shell may exit while a background descendant still holds stdout. Drain/kill the group.
        if (!windows) stop();
      });
      combined.addEventListener('abort', stop, { once: true });
      if (combined.aborted) stop();
      child.once('close', (code) => {
        void (async () => {
          try {
            await cleanup;
            // An overdue timer may not have run yet after event-loop contention.
            if (cleanupDeadline !== undefined && performance.now() >= cleanupDeadline)
              throw new Error('Local cleanup deadline exceeded.');
          } catch {
            throw new ExecutionEnvironmentError(
              'PROCESS_CLEANUP_FAILED',
              'Local process cleanup failed; inspect running processes before retrying.'
            );
          } finally {
            clearTimeout(cleanupTimer);
            combined.removeEventListener('abort', stop);
            cleanupController.abort();
          }
          if (combined.aborted)
            throw new ExecutionEnvironmentError(
              'PROCESS_INTERRUPTED',
              'Local command interrupted or timed out. Its filesystem changes are not rolled back; do not blindly retry.'
            );
          if (failure)
            throw new ExecutionEnvironmentError(
              'PROCESS_FAILED',
              `Local command could not start (${(failure as NodeJS.ErrnoException).code ?? 'unknown'}).`
            );
          resolve({
            exitCode: code ?? 1,
            output: Buffer.concat(chunks).toString('utf8'),
            truncated,
          });
        })().catch(reject);
      });
    });
  }
}
