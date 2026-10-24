import { Inject, Injectable } from '@nestjs/common';
import { SecurityService } from '../../core/security/index.js';
import { UnavailableDomainError } from '../../core/errors/index.js';
import type { BacklogGenerateRequest } from './backlog-plan.schemas.js';
interface Work {
  controller: AbortController;
  promise: Promise<unknown>;
}
@Injectable()
export class BacklogPlanJobRegistry {
  private running?: Work & { input: BacklogGenerateRequest; startedAt: string };
  private readonly work = new Set<Work>();
  private closing = false;
  private shutdown?: Promise<void>;
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {}
  generate(
    input: BacklogGenerateRequest,
    operation: (controller: AbortController, input: BacklogGenerateRequest) => Promise<unknown>
  ): boolean {
    this.assertOpen();
    if (this.running) return false;
    const owned = {
      ...input,
      projectPath: this.security.validateLocalPath(input.projectPath, 'backlog generation'),
    };
    const job = {
      controller: new AbortController(),
      input: owned,
      startedAt: new Date().toISOString(),
      promise: Promise.resolve() as Promise<unknown>,
    };
    this.running = job;
    this.admit(
      job,
      () => operation(job.controller, owned),
      () => {
        if (this.running === job) this.running = undefined;
      }
    );
    return true;
  }
  track<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertOpen();
    const job: Work = { controller: new AbortController(), promise: Promise.resolve() };
    return this.admit(job, () => operation(job.controller.signal)) as Promise<T>;
  }
  private assertOpen(): void {
    if (this.closing || this.work.size >= 32)
      throw new UnavailableDomainError('Backlog operations are unavailable.');
  }
  private admit(
    job: Work,
    operation: () => Promise<unknown>,
    finished?: () => void
  ): Promise<unknown> {
    this.work.add(job);
    job.promise = Promise.resolve()
      .then(() => {
        job.controller.signal.throwIfAborted();
        return operation();
      })
      .finally(() => {
        this.work.delete(job);
        finished?.();
      });
    void job.promise.catch(() => undefined);
    return job.promise;
  }
  stop(): void {
    this.running?.controller.abort();
  }
  get isRunning(): boolean {
    return !!this.running;
  }
  snapshot() {
    const job = this.running;
    return job
      ? {
          projectPath: job.input.projectPath,
          prompt: job.input.prompt,
          model: job.input.model,
          startedAt: job.startedAt,
        }
      : undefined;
  }
  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    for (const job of this.work) job.controller.abort();
    return (this.shutdown = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...this.work].map((job) => job.promise)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new UnavailableDomainError('Backlog cleanup is unconfirmed.')),
              5000
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })());
  }
}
