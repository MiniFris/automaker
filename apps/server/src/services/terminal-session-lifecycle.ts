import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import {
  linuxProcessSession,
  parseLinuxProcessStat,
  waitForLinuxSessionExit,
} from '../core/platform/linux-process-group.js';
import { ManagedTerminalPty, type TerminalPty } from './execution-environment/terminal.js';
import { ExecutionEnvironmentError } from './execution-environment/runtime.js';

export function terminalCleanupError(): ExecutionEnvironmentError {
  return new ExecutionEnvironmentError(
    'TERMINAL_CLEANUP_FAILED',
    'Terminal cleanup could not be confirmed. Session identity was retained.'
  );
}

/** Owns only the original PTY/group; never discovers new PIDs to signal. */
export class TerminalSessionLifecycle {
  private resolveExit!: () => void;
  private readonly exited = new Promise<void>((resolve) => {
    this.resolveExit = resolve;
  });
  private exitSeen = false;
  private group?: number;
  private observationFailed = false;
  private unsafeIdentity = false;
  private ownership = Promise.resolve();
  private capturePending = false;
  private completion?: Promise<void>;
  closing = false;
  private initialSignalFailed = false;
  failureKind?: 'ownership' | 'deadline' | 'target' | 'observation';

  constructor(
    private readonly pty: TerminalPty,
    private readonly windows: boolean
  ) {
    const pid = (pty as TerminalPty & { pid?: number }).pid;
    if (
      !(pty instanceof ManagedTerminalPty) &&
      process.platform === 'linux' &&
      Number.isSafeInteger(pid) &&
      pid! > 1
    ) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const observed = parseLinuxProcessStat(stat);
        const fields = stat
          .slice(stat.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/);
        if (
          pid === process.pid ||
          Number(fields[1]) !== process.pid ||
          !/^\d+$/.test(fields[19] ?? '')
        )
          throw terminalCleanupError();
        if (observed.group === pid && linuxProcessSession(stat) === pid) this.group = pid;
        else {
          this.capturePending = true;
          // forkpty returns in the parent before login_tty/setsid must have run.
          // Wait for that SAME child generation, never infer ownership from a PID alone.
          const start = fields[19];
          const deadline = performance.now() + 3500;
          this.ownership = (async () => {
            while (performance.now() < deadline) {
              await delay(1);
              const next = readFileSync(`/proc/${pid}/stat`, 'utf8');
              const nextFields = next
                .slice(next.lastIndexOf(')') + 1)
                .trim()
                .split(/\s+/);
              if (nextFields[19] !== start || Number(nextFields[1]) !== process.pid) {
                this.unsafeIdentity = true;
                throw terminalCleanupError();
              }
              if (parseLinuxProcessStat(next).group === pid && linuxProcessSession(next) === pid) {
                this.group = pid;
                return;
              }
            }
            throw terminalCleanupError();
          })()
            .catch(() => {
              this.observationFailed = true;
              this.unsafeIdentity = true;
            })
            .finally(() => {
              this.capturePending = false;
            });
        }
      } catch {
        this.observationFailed = true;
        this.unsafeIdentity = true;
      }
    }
  }

  markExited(): void {
    this.exitSeen = true;
    this.resolveExit();
  }

  async ready(): Promise<void> {
    await this.ownership;
    if (this.observationFailed) throw terminalCleanupError();
  }

  requestClose(): boolean {
    if (!this.completion) {
      this.closing = true;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      this.completion = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void this.drain().then(resolve, reject);
    }
    return !this.initialSignalFailed;
  }

  close(): Promise<void> {
    this.requestClose();
    return this.completion!;
  }

  private signal(signal: string): void {
    if (this.unsafeIdentity) throw terminalCleanupError();
    if (this.group) {
      try {
        process.kill(-this.group, signal as NodeJS.Signals);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    } else if (!this.exitSeen) {
      if (this.windows) this.pty.kill();
      else this.pty.kill(signal);
    }
  }

  private async drain(): Promise<void> {
    const managed = this.pty instanceof ManagedTerminalPty;
    const timeoutMs = managed ? 22_000 : 3_500;
    const deadline = performance.now() + timeoutMs;
    const controller = new AbortController();
    let escalation: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      if (this.capturePending) await this.ownership;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        try {
          this.signal('SIGKILL');
        } catch {
          // Deadline failure below remains authoritative even if escalation fails.
        }
        throw terminalCleanupError();
      }
      try {
        this.signal('SIGTERM');
      } catch {
        this.initialSignalFailed = true;
      }
      if (!managed)
        escalation = setTimeout(
          () => {
            try {
              this.signal('SIGKILL');
            } catch {
              /* confirmation below remains authoritative */
            }
          },
          Math.min(1000, Math.max(0, remaining - 100))
        );
      const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(terminalCleanupError());
          },
          Math.max(1, deadline - performance.now())
        );
      });
      await Promise.race([
        Promise.all([
          this.exited,
          this.group ? waitForLinuxSessionExit(this.group, controller.signal) : Promise.resolve(),
        ]),
        expired,
      ]);
      if (
        performance.now() >= deadline ||
        this.observationFailed ||
        (this.pty instanceof ManagedTerminalPty && !this.pty.exitConfirmed)
      )
        throw terminalCleanupError();
    } catch {
      this.failureKind = this.observationFailed
        ? 'ownership'
        : controller.signal.aborted || performance.now() >= deadline
          ? 'deadline'
          : this.pty instanceof ManagedTerminalPty && !this.pty.exitConfirmed
            ? 'target'
            : 'observation';
      throw terminalCleanupError();
    } finally {
      if (timer) clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      controller.abort();
    }
  }
}
