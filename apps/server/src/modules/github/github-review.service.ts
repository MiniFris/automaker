import { HttpException, Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  ConflictDomainError,
  DomainError,
  TimeoutDomainError,
  UnavailableDomainError,
  UnknownOutcomeDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import { GithubReadPort } from './github-read.port.js';
import { GithubCommentsReadPort, GithubReviewMutationPort } from './github-review.port.js';
import type {
  GithubIssueCommentsRequest,
  GithubReviewCommentsRequest,
  GithubResolveThreadRequest,
} from './github-review.schemas.js';
import { GithubCommandError } from './github-command.runtime.js';

export class GithubReviewCleanupError extends Error {
  readonly code = 'GITHUB_REVIEW_CLEANUP_FAILED';
  constructor() {
    super('GitHub review cleanup or mutation outcome could not be confirmed.');
  }
}
@Injectable()
export class GithubReviewService implements OnModuleDestroy {
  private readonly active = new Map<Promise<unknown>, AbortController>();
  private readonly mutations = new Set<string>();
  private readonly unconfirmed = new Set<string>();
  private stopping = false;
  private shutdown?: Promise<void>;
  constructor(
    @Inject(GithubReadPort) private readonly reads: GithubReadPort,
    @Inject(GithubCommentsReadPort) private readonly comments: GithubCommentsReadPort,
    @Inject(GithubReviewMutationPort) private readonly writes: GithubReviewMutationPort
  ) {}
  issueComments(input: GithubIssueCommentsRequest) {
    return this.run(async (signal) => {
      const remote = await this.remote(input.projectPath, signal);
      return {
        success: true,
        ...(await this.comments.issueComments(
          input.projectPath,
          remote,
          input.issueNumber,
          input.cursor,
          signal
        )),
      };
    });
  }
  reviewComments(input: GithubReviewCommentsRequest) {
    return this.run(async (signal) => {
      const remote = await this.remote(input.projectPath, signal);
      const comments = await this.comments.reviewComments(
        input.projectPath,
        remote,
        input.prNumber,
        signal
      );
      return { success: true, comments, totalCount: comments.length };
    });
  }
  resolve(input: GithubResolveThreadRequest) {
    // Thread IDs are host-global. Conservatively reserve across project path aliases.
    if (this.unconfirmed.has(input.threadId))
      throw new UnknownOutcomeDomainError(
        'GitHub thread mutation outcome remains unconfirmed. No replacement was started.'
      );
    if (this.mutations.has(input.threadId))
      throw new ConflictDomainError('A mutation for this review thread is still running.');
    return this.run(async (signal) => {
      const remote = await this.remote(input.projectPath, signal);
      return {
        success: true,
        ...(await this.writes.resolveThread(
          input.projectPath,
          remote,
          input.threadId,
          input.resolve,
          signal
        )),
      };
    }, input.threadId);
  }
  private async remote(projectPath: string, signal: AbortSignal) {
    const remote = await this.reads.remote(projectPath, signal);
    if (!remote.hasGitHubRemote)
      throw new ValidationDomainError('Project does not have a GitHub remote');
    return remote;
  }
  private run<T>(operation: (signal: AbortSignal) => Promise<T>, mutation?: string): Promise<T> {
    if (this.stopping) throw new UnavailableDomainError('GitHub review is shutting down.');
    if (this.active.size >= 8) throw new UnavailableDomainError('GitHub review is busy.');
    if (mutation) this.mutations.add(mutation);
    const controller = new AbortController(),
      deadline = performance.now() + 60_000;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const task = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return operation(controller.signal);
      })
      .then((value) => {
        // A mutation port returns only an authoritative confirmation, not a best guess.
        if (!mutation && performance.now() >= deadline)
          throw new TimeoutDomainError('GitHub review timed out.');
        if (!mutation && controller.signal.aborted)
          throw new UnavailableDomainError('GitHub review request was cancelled.');
        return value;
      })
      .catch((error) => {
        if (mutation && error instanceof UnknownOutcomeDomainError) this.unconfirmed.add(mutation);
        if (error instanceof DomainError) throw error;
        if (error instanceof GithubCommandError) {
          if (error.rateLimited)
            throw new HttpException('GitHub request rate limit exceeded.', 429);
          if (error.kind === 'deadline' || performance.now() >= deadline)
            throw new TimeoutDomainError('GitHub review timed out.');
          throw new UnavailableDomainError('GitHub review is unavailable.');
        }
        throw new UnavailableDomainError('GitHub review request could not be completed.');
      })
      .finally(() => {
        clearTimeout(timeout);
        controller.abort();
        this.active.delete(task);
        if (mutation) this.mutations.delete(mutation);
      });
    this.active.set(task, controller);
    return task;
  }
  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const tasks = [...this.active.keys()];
    for (const controller of this.active.values()) controller.abort();
    let timer: NodeJS.Timeout | undefined;
    const deadline = performance.now() + 5000;
    this.shutdown = Promise.race([
      Promise.allSettled(tasks).then(() => {
        if (this.unconfirmed.size || performance.now() >= deadline)
          throw new GithubReviewCleanupError();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new GithubReviewCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
