import { Inject, Injectable } from '@nestjs/common';
import { SecurityService } from '../../core/security/index.js';
import { UnavailableDomainError } from '../../core/errors/index.js';
import type { AppSpecOperation } from './app-spec-workflow.port.js';
interface RunningJob {
  controller: AbortController;
  type: AppSpecOperation;
  startedAt: string;
  promise: Promise<void>;
}
@Injectable()
export class AppSpecJobRegistry {
  private readonly jobs = new Map<string, RunningJob>();
  private closing = false;
  private shutdown?: Promise<void>;
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {}
  run(
    project: string,
    type: AppSpecOperation,
    operation: (controller: AbortController, projectPath: string) => Promise<void>
  ): boolean {
    if (this.closing) throw new UnavailableDomainError('Specification jobs are unavailable.');
    const projectPath = this.security.validateLocalPath(project, 'specification job');
    if (this.jobs.has(projectPath)) return false;
    if (this.jobs.size >= 8)
      throw new UnavailableDomainError('Specification jobs are unavailable.');
    const job: RunningJob = {
      controller: new AbortController(),
      type,
      startedAt: new Date().toISOString(),
      promise: Promise.resolve(),
    };
    this.jobs.set(projectPath, job);
    job.promise = Promise.resolve()
      .then(() => {
        job.controller.signal.throwIfAborted();
        return operation(job.controller, projectPath);
      })
      .finally(() => {
        if (this.jobs.get(projectPath) === job) this.jobs.delete(projectPath);
      });
    void job.promise.catch(() => undefined);
    return true;
  }
  stop(project?: string): void {
    if (project !== undefined)
      this.jobs
        .get(this.security.validateLocalPath(project, 'stop specification job'))
        ?.controller.abort();
    else for (const job of this.jobs.values()) job.controller.abort();
  }
  snapshot() {
    return [...this.jobs].map(([projectPath, job]) => ({
      projectPath,
      type: job.type,
      startedAt: job.startedAt,
    }));
  }
  status(project?: string) {
    if (project === undefined) return { isRunning: this.jobs.size > 0 };
    const projectPath = this.security.validateLocalPath(project, 'specification job status');
    const job = this.jobs.get(projectPath);
    return {
      isRunning: !!job,
      projectPath,
      ...(job && { type: job.type, startedAt: job.startedAt }),
    };
  }
  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    this.stop();
    return (this.shutdown = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...this.jobs.values()].map((job) => job.promise)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new UnavailableDomainError('Specification job cleanup is unconfirmed.')),
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
