import { Injectable } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';
import { createListCommentsHandler } from '../../routes/github/routes/list-comments.js';
import { createListPRReviewCommentsHandler } from '../../routes/github/routes/list-pr-review-comments.js';
import { createResolvePRCommentHandler } from '../../routes/github/routes/resolve-pr-comment.js';

export type GithubHandlerName = keyof ReturnType<GithubHandlersService['createHandlers']>;

/**
 * Compatibility boundary around GitHub CLI/storage operations. Nest owns HTTP,
 * authentication and path authorization while the operations are decomposed further.
 */
@Injectable()
export class GithubHandlersService {
  private readonly handlers: Record<string, RequestHandler>;

  constructor() {
    this.handlers = this.createHandlers();
  }

  run(name: GithubHandlerName, request: Request, response: Response): Promise<void> {
    return Promise.resolve(
      this.handlers[name](request, response, (error?: unknown) => {
        if (error) throw error;
      }) as void | Promise<void>
    );
  }

  private createHandlers() {
    return {
      issueComments: createListCommentsHandler(),
      prReviewComments: createListPRReviewCommentsHandler(),
      resolvePrComment: createResolvePRCommentHandler(),
    } satisfies Record<string, RequestHandler>;
  }
}
