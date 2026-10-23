import { Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { GithubHandlersService, type GithubHandlerName } from './github-handlers.service.js';

@Controller('github')
@UseGuards(AllowedPathGuard)
@AllowedPathFields('projectPath')
export class GithubController {
  constructor(@Inject(GithubHandlersService) private readonly handlers: GithubHandlersService) {}

  private run(name: GithubHandlerName, request: Request, response: Response) {
    return this.handlers.run(name, request, response);
  }

  @Post('check-remote') checkRemote(@Req() q: Request, @Res() s: Response) {
    return this.run('checkRemote', q, s);
  }
  @Post('issues') issues(@Req() q: Request, @Res() s: Response) {
    return this.run('issues', q, s);
  }
  @Post('prs') prs(@Req() q: Request, @Res() s: Response) {
    return this.run('prs', q, s);
  }
  @Post('issue-comments') issueComments(@Req() q: Request, @Res() s: Response) {
    return this.run('issueComments', q, s);
  }
  @Post('pr-review-comments') prReviewComments(@Req() q: Request, @Res() s: Response) {
    return this.run('prReviewComments', q, s);
  }
  @Post('resolve-pr-comment') resolvePrComment(@Req() q: Request, @Res() s: Response) {
    return this.run('resolvePrComment', q, s);
  }
  @Post('validate-issue') validateIssue(@Req() q: Request, @Res() s: Response) {
    return this.run('validateIssue', q, s);
  }
  @Post('validation-status') validationStatus(@Req() q: Request, @Res() s: Response) {
    return this.run('validationStatus', q, s);
  }
  @Post('validation-stop') validationStop(@Req() q: Request, @Res() s: Response) {
    return this.run('validationStop', q, s);
  }
  @Post('validations') validations(@Req() q: Request, @Res() s: Response) {
    return this.run('validations', q, s);
  }
  @Post('validation-delete') validationDelete(@Req() q: Request, @Res() s: Response) {
    return this.run('validationDelete', q, s);
  }
  @Post('validation-mark-viewed') validationMarkViewed(@Req() q: Request, @Res() s: Response) {
    return this.run('validationMarkViewed', q, s);
  }
}
