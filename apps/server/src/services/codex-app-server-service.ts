import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
import type { BeforeApplicationShutdown, OnApplicationShutdown } from '@nestjs/common';
import type {
  AppServerModelResponse,
  AppServerAccountResponse,
  AppServerRateLimitsResponse,
} from '@automaker/types';
import { CodexUsageRuntime } from '../core/platform/codex-usage.runtime.js';
import { legacyCodexUsageRuntime } from './codex-usage-compat.js';
import { waitForLinuxProcessGroupExit } from '../core/platform/linux-process-group.js';

interface Limits {
  requestMs: number;
  killMs: number;
  cleanupMs: number;
}
const defaults: Limits = { requestMs: 10000, killMs: 500, cleanupMs: 2000 };

export class CodexAppServerCleanupError extends Error {
  constructor() {
    super('Codex app-server cleanup could not be confirmed.');
  }
}

/** Read-only RPC owner: no thread/turn creation, login, tools or approval handling. */
export class CodexAppServerService implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly active = new Map<Promise<unknown>, AbortController>();
  private closing: Promise<void> | undefined;
  private poisoned = false;
  constructor(
    private readonly runtime: CodexUsageRuntime = legacyCodexUsageRuntime,
    private readonly limits: Limits = defaults
  ) {}

  async isAvailable(): Promise<boolean> {
    this.assertAccepting();
    return Boolean((await this.runtime.snapshot()).cliPath);
  }
  getModels(): Promise<AppServerModelResponse | null> {
    return this.request('model/list', {});
  }
  getAccount(): Promise<AppServerAccountResponse | null> {
    return this.request('account/read', { refreshToken: false });
  }
  getRateLimits(): Promise<AppServerRateLimitsResponse | null> {
    return this.request('account/rateLimits/read', {});
  }

  private assertAccepting(): void {
    if (this.closing || this.poisoned) throw new Error('Codex app-server is unavailable.');
  }

  private request<T>(method: string, params: unknown): Promise<T | null> {
    try {
      this.assertAccepting();
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.active.size >= 4) return Promise.reject(new Error('Codex app-server is busy.'));
    const controller = new AbortController();
    const pending = Promise.resolve().then(() => this.execute<T>(method, params, controller));
    this.active.set(pending, controller);
    void pending.then(
      () => this.active.delete(pending),
      () => this.active.delete(pending)
    );
    return pending;
  }

  private async execute<T>(
    method: string,
    params: unknown,
    controller: AbortController
  ): Promise<T | null> {
    let child: ChildProcessWithoutNullStreams | undefined;
    let closed = false;
    let closedPromise: Promise<void> = Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    let cancelSnapshot: (() => void) | undefined;
    const deadline = performance.now() + this.limits.requestMs;
    const operation = async (): Promise<T | null> => {
      try {
        if (controller.signal.aborted) return null;
        timer = setTimeout(() => controller.abort(), this.limits.requestMs);
        const snapshot = await Promise.race([
          this.runtime.snapshot(controller.signal),
          new Promise<never>((_, reject) => {
            cancelSnapshot = () => reject(new Error('Codex discovery cancelled.'));
            controller.signal.addEventListener('abort', cancelSnapshot, { once: true });
          }),
        ]);
        if (controller.signal.aborted || performance.now() >= deadline || !snapshot.cliPath)
          return null;
        child = spawn(snapshot.cliPath, ['app-server'], {
          cwd: snapshot.workingDirectory,
          env: { ...snapshot.environment, TERM: 'dumb' },
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          shell: process.platform === 'win32' && snapshot.cliPath.toLowerCase().endsWith('.cmd'),
        });
        const processRef = child;
        closedPromise = new Promise<void>((resolve) => {
          child!.once('close', () => {
            closed = true;
            resolve();
          });
          child!.once('error', () => {
            if (!child!.pid) {
              closed = true;
              resolve();
            }
          });
        });
        return await new Promise<T>((resolve, reject) => {
          let buffer = '',
            bytes = 0,
            messages = 0,
            ready = false;
          const decoder = new StringDecoder('utf8');
          const fail = () => reject(new Error('Codex app-server query failed.'));
          controller.signal.addEventListener('abort', fail, { once: true });
          processRef.once('error', fail);
          processRef.once('close', fail);
          processRef.stdin.on('error', fail);
          processRef.stderr.on('data', () => {
            /* Drain without retaining diagnostics or secrets. */
          });
          processRef.stdout.on('data', (chunk: Buffer) => {
            if (controller.signal.aborted || performance.now() >= deadline) {
              fail();
              return;
            }
            bytes += chunk.length;
            buffer += decoder.write(chunk);
            if (bytes > 1048576 || buffer.length > 131072) {
              fail();
              return;
            }
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newline);
              buffer = buffer.slice(newline + 1);
              if (!line.trim()) continue;
              if (++messages > 1000) {
                fail();
                return;
              }
              try {
                const message = JSON.parse(line);
                if (
                  !message ||
                  typeof message !== 'object' ||
                  Array.isArray(message) ||
                  message.error ||
                  ('id' in message && 'method' in message)
                ) {
                  fail();
                  return;
                }
                if (message.id === 1 && !ready) {
                  if (!message.result || typeof message.result !== 'object') {
                    fail();
                    return;
                  }
                  ready = true;
                  processRef.stdin.write(
                    JSON.stringify({ method: 'initialized', params: {} }) + '\n'
                  );
                  processRef.stdin.write(JSON.stringify({ id: 2, method, params }) + '\n');
                } else if (message.id === 2 && ready) {
                  if (!message.result || typeof message.result !== 'object') {
                    fail();
                    return;
                  }
                  resolve(message.result as T);
                }
              } catch {
                fail();
                return;
              }
            }
          });
          if (controller.signal.aborted) {
            fail();
            return;
          }
          processRef.stdin.write(
            JSON.stringify({
              id: 1,
              method: 'initialize',
              params: {
                clientInfo: { name: 'automaker-usage', title: 'AutoMaker', version: '1.0.0' },
              },
            }) + '\n'
          );
        });
      } catch {
        return null; // Established unavailable/fallback result; never reflect raw CLI output.
      }
    };
    const result = await operation();
    clearTimeout(timer);
    if (cancelSnapshot) controller.signal.removeEventListener('abort', cancelSnapshot);
    if (child) {
      try {
        await this.cleanup(child, closedPromise, () => closed);
      } catch {
        this.poisoned = true;
        throw new CodexAppServerCleanupError();
      }
    }
    return result;
  }

  private async cleanup(
    child: ChildProcessWithoutNullStreams,
    exited: Promise<void>,
    closed: () => boolean
  ): Promise<void> {
    const observer = new AbortController();
    const deadline = performance.now() + this.limits.cleanupMs;
    const signal = (name: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid && child.pid > 1)
          process.kill(-child.pid, name);
        else if (!closed()) child.kill(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    let force: NodeJS.Timeout | undefined, watchdog: NodeJS.Timeout | undefined;
    try {
      child.stdin.end();
      signal('SIGTERM');
      force = setTimeout(() => {
        try {
          signal('SIGKILL');
        } catch {
          observer.abort();
        }
      }, this.limits.killMs);
      const timeout = new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => {
          observer.abort();
          reject(new Error('Cleanup deadline exceeded.'));
        }, this.limits.cleanupMs);
      });
      await Promise.race([
        timeout,
        (async () => {
          await exited;
          if (process.platform === 'linux' && child.pid)
            await waitForLinuxProcessGroupExit(child.pid, observer.signal);
        })(),
      ]);
      if (performance.now() >= deadline) throw new Error('Cleanup deadline exceeded.');
    } finally {
      clearTimeout(force);
      clearTimeout(watchdog);
      observer.abort();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    }
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.onApplicationShutdown();
  }

  onApplicationShutdown(): Promise<void> {
    if (!this.closing) {
      this.closing = Promise.resolve().then(async () => {
        await Promise.allSettled([...this.active.keys()]);
        if (this.poisoned) throw new CodexAppServerCleanupError();
      });
      for (const controller of this.active.values()) controller.abort();
    }
    return this.closing;
  }
}
