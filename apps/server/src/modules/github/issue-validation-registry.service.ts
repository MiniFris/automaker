import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { ProviderCleanupError } from '../../providers/provider-execution-scope.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';

interface ValidationTask {
  projectPath: string;
  issueNumber: number;
  startedAt: Date;
  controller: AbortController;
  completion: Promise<void>;
  timeout?: NodeJS.Timeout;
  cleanupFailed: boolean;
}

export class IssueValidationCleanupError extends Error {
  readonly code = 'ISSUE_VALIDATION_CLEANUP_FAILED';
  constructor() {
    super('Issue validation cleanup could not be confirmed.');
  }
}

/** Application-owned reservations: cancellation is not proof that an issue slot is free. */
@Injectable()
export class IssueValidationRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly tasks = new Map<string, ValidationTask>();
  private interval?: NodeJS.Timeout;
  private stopping = false;
  private shutdown?: Promise<void>;

  onModuleInit(): void {
    if (this.interval || this.stopping) return;
    this.interval = setInterval(() => this.cleanupStale(), 60 * 60 * 1000);
    this.interval.unref();
  }

  start(
    projectPath: string,
    issueNumber: number,
    operation: (controller: AbortController) => Promise<void>
  ): boolean {
    if (this.stopping) throw new UnavailableDomainError('Issue validation is shutting down.');
    const key = JSON.stringify([projectPath, issueNumber]);
    if (this.tasks.get(key)?.cleanupFailed)
      throw new UnavailableDomainError(
        'Issue validation cleanup is unconfirmed. No replacement was started.'
      );
    if (this.tasks.has(key)) return false;
    const task: ValidationTask = {
      projectPath,
      issueNumber,
      startedAt: new Date(),
      controller: new AbortController(),
      completion: Promise.resolve(),
      cleanupFailed: false,
    };
    this.tasks.set(key, task);
    task.timeout = setTimeout(() => this.cancel(task), 360_000);
    task.completion = Promise.resolve()
      .then(async () => {
        if (!task.controller.signal.aborted) await operation(task.controller);
      })
      .catch((error) => {
        task.cleanupFailed =
          error instanceof ProviderCleanupError ||
          (error instanceof ExecutionEnvironmentError &&
            ['PROCESS_CLEANUP_FAILED', 'SSH_CLEANUP_UNVERIFIED', 'SSH_OUTCOME_UNKNOWN'].includes(
              error.code
            ));
      })
      .finally(() => {
        clearTimeout(task.timeout);
        if (!task.cleanupFailed && this.tasks.get(key) === task) this.tasks.delete(key);
      });
    return true;
  }

  status(projectPath: string, issueNumber: number): { isRunning: boolean; startedAt: Date } | null {
    const task = this.tasks.get(JSON.stringify([projectPath, issueNumber]));
    return task ? { isRunning: true, startedAt: new Date(task.startedAt) } : null;
  }

  running(projectPath: string): number[] {
    return [...this.tasks.values()]
      .filter((task) => task.projectPath === projectPath)
      .map((task) => task.issueNumber);
  }

  hasUnconfirmed(projectPath: string, issueNumber?: number): boolean {
    return [...this.tasks.values()].some(
      (task) =>
        task.projectPath === projectPath &&
        (issueNumber === undefined || task.issueNumber === issueNumber) &&
        task.cleanupFailed
    );
  }

  abort(projectPath: string, issueNumber: number): boolean {
    const task = this.tasks.get(JSON.stringify([projectPath, issueNumber]));
    if (!task) return false;
    this.cancel(task);
    return true;
  }

  private cancel(task: ValidationTask): void {
    clearTimeout(task.timeout);
    task.controller.abort();
  }

  cleanupStale(): number {
    let requested = 0;
    for (const task of this.tasks.values()) {
      if (
        Date.now() - task.startedAt.getTime() > 60 * 60 * 1000 &&
        !task.controller.signal.aborted
      ) {
        this.cancel(task);
        requested++;
      }
    }
    return requested;
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    clearInterval(this.interval);
    this.interval = undefined;
    const tasks = [...this.tasks.values()];
    for (const task of tasks) this.cancel(task);
    const deadline = performance.now() + 25_000;
    let timer: NodeJS.Timeout | undefined;
    this.shutdown = Promise.race([
      Promise.all(tasks.map((task) => task.completion)).then(() => {
        if (tasks.some((task) => task.cleanupFailed) || performance.now() >= deadline)
          throw new IssueValidationCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new IssueValidationCleanupError()), 25_000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
