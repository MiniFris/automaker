import { RateLimitDomainError } from '../../core/errors/domain-errors.js';

import { performance } from 'node:perf_hooks';
import {
  TimeoutDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import { GithubReadPort } from './github-read.port.js';
import { GithubCommandError } from './github-command.errors.js';

export class GithubDiscoveryCleanupError extends Error {
  readonly code = 'GITHUB_DISCOVERY_CLEANUP_FAILED';
  constructor() {
    super('GitHub discovery cleanup could not be confirmed.');
  }
}

export class GithubDiscoveryService {
  private readonly active = new Map<Promise<unknown>, AbortController>();
  private shutdown?: Promise<void>;
  constructor(private readonly reads: GithubReadPort) {}
  remote(projectPath: string) {
    return this.run(async (signal) => ({
      success: true,
      ...(await this.reads.remote(projectPath, signal)),
    }));
  }
  issues(projectPath: string) {
    return this.run(async (signal) => {
      const remote = await this.reads.remote(projectPath, signal);
      if (!remote.hasGitHubRemote)
        throw new ValidationDomainError('Project does not have a GitHub remote');
      return { success: true, ...(await this.reads.issues(projectPath, remote, signal)) };
    });
  }
  prs(projectPath: string) {
    return this.run(async (signal) => {
      const remote = await this.reads.remote(projectPath, signal);
      if (!remote.hasGitHubRemote)
        throw new ValidationDomainError('Project does not have a GitHub remote');
      return { success: true, ...(await this.reads.prs(projectPath, remote, signal)) };
    });
  }

  private run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.shutdown) throw new UnavailableDomainError('GitHub discovery is shutting down.');
    if (this.active.size >= 8) throw new UnavailableDomainError('GitHub discovery is busy.');
    const controller = new AbortController();
    const deadline = performance.now() + 60_000;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const task = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return operation(controller.signal);
      })
      .then((value) => {
        if (performance.now() >= deadline)
          throw new TimeoutDomainError('GitHub discovery timed out.');
        if (controller.signal.aborted)
          throw new UnavailableDomainError('GitHub discovery was cancelled.');
        return value;
      })
      .catch((error) => {
        if (error instanceof GithubCommandError) {
          if (error.rateLimited)
            throw new RateLimitDomainError('GitHub request rate limit exceeded.');
          if (error.kind === 'deadline' || performance.now() >= deadline)
            throw new TimeoutDomainError('GitHub discovery timed out.');
          throw new UnavailableDomainError('GitHub discovery is unavailable.');
        }
        if (controller.signal.aborted)
          throw new UnavailableDomainError('GitHub discovery was cancelled.');
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        controller.abort();
        this.active.delete(task);
      });
    this.active.set(task, controller);
    return task;
  }
  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    for (const controller of this.active.values()) controller.abort();
    let timer: NodeJS.Timeout | undefined;
    const deadline = performance.now() + 5000;
    this.shutdown = Promise.race([
      Promise.allSettled([...this.active.keys()]).then(() => {
        if (performance.now() >= deadline) throw new GithubDiscoveryCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new GithubDiscoveryCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
