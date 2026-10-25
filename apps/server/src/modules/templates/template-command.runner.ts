import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { CancellationDomainError, UnavailableDomainError } from '../../core/errors/index.js';
import {
  createOwnedLocalChild,
  OwnedLocalChildCleanupError,
  type OwnedLocalChild,
} from '../../services/owned-local-child.js';

export interface CommandResult {
  exitCode: number | null;
  stderr: string;
}
export interface TemplateCommandRunner {
  run(
    command: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal
  ): Promise<CommandResult>;
}
export interface TemplateCommandRuntime {
  platform: NodeJS.Platform;
  spawn(command: string, args: readonly string[], cwd: string): ChildProcess;
}
export const TEMPLATE_COMMAND_RUNNER = Symbol('TEMPLATE_COMMAND_RUNNER');
interface ActiveTemplateCommand {
  controller: AbortController;
  child?: ChildProcess;
  owner?: OwnedLocalChild;
}

@Injectable()
export class SpawnTemplateCommandRunner implements TemplateCommandRunner {
  private readonly active = new Map<Promise<CommandResult>, ActiveTemplateCommand>();
  private stopping = false;
  private shutdown?: Promise<void>;
  private uncertain = false;
  constructor(
    private readonly runtime: TemplateCommandRuntime = {
      platform: process.platform,
      spawn: (command, args, cwd) =>
        spawn(command, [...args], {
          cwd,
          shell: false,
          detached: process.platform === 'linux',
          stdio: ['ignore', 'ignore', 'pipe'],
        }),
    }
  ) {}

  run(
    command: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal
  ): Promise<CommandResult> {
    if (this.stopping || this.uncertain || this.active.size >= 32)
      return Promise.reject(new UnavailableDomainError('Template commands are unavailable.'));
    const controller = new AbortController();
    const entry: ActiveTemplateCommand = { controller };
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const pending = Promise.resolve().then(() => this.execute(command, args, cwd, entry));
    this.active.set(pending, entry);
    void pending
      .then(
        () => this.active.delete(pending),
        (error) => {
          if (error instanceof OwnedLocalChildCleanupError) this.uncertain = true;
          else this.active.delete(pending);
        }
      )
      .finally(() => signal?.removeEventListener('abort', abort));
    return pending;
  }

  private async execute(
    command: string,
    args: readonly string[],
    cwd: string,
    entry: ActiveTemplateCommand
  ): Promise<CommandResult> {
    const signal = entry.controller.signal;
    if (signal.aborted) throw new CancellationDomainError('Template command cancelled.');
    const child = this.runtime.spawn(command, args, cwd);
    entry.child = child;
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += data.toString().slice(0, 64 * 1024 - stderr.length);
    });
    const outcome = new Promise<CommandResult>((resolve, reject) => {
      child.once('error', reject);
      child.once(this.runtime.platform === 'linux' ? 'exit' : 'close', (exitCode) =>
        resolve({ exitCode, stderr })
      );
    });
    void outcome.catch(() => {});
    if (this.runtime.platform === 'linux') {
      const owner = createOwnedLocalChild(child);
      entry.owner = owner;
      const abort = () => {
        void owner.close().catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try {
        await owner.ready();
        const [result] = await Promise.all([outcome, owner.completion()]);
        if (signal.aborted) throw new CancellationDomainError('Template command cancelled.');
        return { ...result, stderr };
      } catch (error) {
        await owner.close();
        // Affirmative failed-spawn cleanup has no resource; preserve its original startup error.
        if (child.pid === undefined) await outcome;
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
        child.stderr?.destroy();
      }
    }
    // Preserve existing non-Linux root-process compatibility; this is not tree certification.
    let escalation: NodeJS.Timeout | undefined, timeout: NodeJS.Timeout | undefined;
    let rejectCleanup!: (error: unknown) => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCleanup = reject;
    });
    const abort = () => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      } catch {
        /* Continue the independently safe original-child attempt. */
      }
      escalation = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* Deadline below remains authoritative. */
          }
        }
      }, 1000);
      timeout = setTimeout(() => rejectCleanup(new OwnedLocalChildCleanupError()), 5000);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try {
      const result = await Promise.race([outcome, cancelled]);
      if (signal.aborted) throw new CancellationDomainError('Template command cancelled.');
      return result;
    } finally {
      signal.removeEventListener('abort', abort);
      clearTimeout(escalation);
      clearTimeout(timeout);
      child.stderr?.destroy();
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const pending = [...this.active];
    for (const [, entry] of pending) entry.controller.abort();
    this.shutdown = Promise.allSettled(pending.map(([operation]) => operation)).then((results) => {
      if (
        this.uncertain ||
        results.some(
          (result) =>
            result.status === 'rejected' && result.reason instanceof OwnedLocalChildCleanupError
        )
      )
        throw new OwnedLocalChildCleanupError();
    });
    return this.shutdown;
  }
}
