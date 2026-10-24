import { performance } from 'node:perf_hooks';
import { UnavailableDomainError } from '../../core/errors/index.js';

export class IdeationCleanupError extends Error {
  readonly code = 'IDEATION_CLEANUP_FAILED';
  constructor() {
    super('Ideation cleanup could not be confirmed.');
  }
}

export function isUnconfirmedIdeationCleanup(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; errorCode?: unknown };
  return /CLEANUP_FAILED|OUTCOME_UNKNOWN|UNKNOWN_OUTCOME/.test(
    String(value.code ?? value.errorCode ?? '')
  );
}

/** Per-service accepted work owner. No global queue or detached provider promises. */
export class IdeationJobs {
  private readonly jobs = new Map<Promise<unknown>, AbortController>();
  private stopping = false;
  private closing?: Promise<void>;
  private uncertain = false;

  assertOpen(): void {
    if (this.stopping) throw new UnavailableDomainError('Ideation is shutting down.');
    if (this.uncertain)
      throw new UnavailableDomainError('Ideation cleanup could not be confirmed.');
    if (this.jobs.size >= 64) throw new UnavailableDomainError('Ideation command queue is busy.');
  }

  run<T>(
    action: (controller: AbortController) => Promise<T>,
    controller = new AbortController()
  ): Promise<T> {
    this.assertOpen();
    const task = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return action(controller);
      })
      .catch((error) => {
        if (isUnconfirmedIdeationCleanup(error)) this.uncertain = true;
        throw error;
      })
      .finally(() => this.jobs.delete(task));
    this.jobs.set(task, controller);
    return task;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true;
    for (const controller of this.jobs.values()) controller.abort();
    const accepted = [...this.jobs.keys()];
    const deadline = performance.now() + 5000;
    let timer: NodeJS.Timeout | undefined;
    this.closing = Promise.race([
      Promise.allSettled(accepted).then(() => {
        if (performance.now() >= deadline || this.uncertain) throw new IdeationCleanupError();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdeationCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }

  wait(task?: Promise<unknown>): Promise<void> {
    if (!task) return Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      task.then(() => undefined),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdeationCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
  }
}
