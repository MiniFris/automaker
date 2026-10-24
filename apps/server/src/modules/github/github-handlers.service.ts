import { Inject, Injectable } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { createCheckGitHubRemoteHandler } from '../../routes/github/routes/check-github-remote.js';
import { createListCommentsHandler } from '../../routes/github/routes/list-comments.js';
import { createListIssuesHandler } from '../../routes/github/routes/list-issues.js';
import { createListPRReviewCommentsHandler } from '../../routes/github/routes/list-pr-review-comments.js';
import { createListPRsHandler } from '../../routes/github/routes/list-prs.js';
import { createResolvePRCommentHandler } from '../../routes/github/routes/resolve-pr-comment.js';
import { createValidateIssueHandler } from '../../routes/github/routes/validate-issue.js';
import {
  createDeleteValidationHandler,
  createGetValidationsHandler,
  createMarkViewedHandler,
  createValidationStatusHandler,
  createValidationStopHandler,
} from '../../routes/github/routes/validation-endpoints.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';

export type GithubHandlerName = keyof ReturnType<GithubHandlersService['createHandlers']>;

/**
 * Compatibility boundary around GitHub CLI/storage operations. Nest owns HTTP,
 * authentication and path authorization while the operations are decomposed further.
 */
@Injectable()
export class GithubHandlersService {
  private readonly handlers: Record<string, RequestHandler>;

  constructor(
    @Inject(APPLICATION_EVENTS) events: EventEmitter,
    @Inject(SettingsService) settings: SettingsService,
    @Inject(ProviderRegistry) providers: ProviderRegistry
  ) {
    this.handlers = this.createHandlers(events, settings, providers);
  }

  run(name: GithubHandlerName, request: Request, response: Response): Promise<void> {
    return Promise.resolve(
      this.handlers[name](request, response, (error?: unknown) => {
        if (error) throw error;
      }) as void | Promise<void>
    );
  }

  private createHandlers(
    events: EventEmitter,
    settings: SettingsService,
    providers: ProviderRegistry
  ) {
    return {
      checkRemote: createCheckGitHubRemoteHandler(),
      issues: createListIssuesHandler(),
      prs: createListPRsHandler(),
      issueComments: createListCommentsHandler(),
      prReviewComments: createListPRReviewCommentsHandler(),
      resolvePrComment: createResolvePRCommentHandler(),
      validateIssue: createValidateIssueHandler(events, settings, providers),
      validationStatus: createValidationStatusHandler(),
      validationStop: createValidationStopHandler(),
      validations: createGetValidationsHandler(),
      validationDelete: createDeleteValidationHandler(),
      validationMarkViewed: createMarkViewedHandler(events),
    } satisfies Record<string, RequestHandler>;
  }
}
