import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { GithubHandlersService, type GithubHandlerName } from './github-handlers.service.js';
import { IssueValidationService } from './issue-validation.service.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  IssueValidationRequestSchema,
  IssueValidationStatusSchema,
  IssueValidationStopSchema,
  type IssueValidationRequest,
  type IssueValidationStatusRequest,
  type IssueValidationStopRequest,
} from './issue-validation.schemas.js';

@Controller('github')
@UseGuards(AllowedPathGuard)
@AllowedPathFields('projectPath')
export class GithubController {
  constructor(
    @Inject(GithubHandlersService) private readonly handlers: GithubHandlersService,
    @Inject(IssueValidationService) private readonly issueValidations: IssueValidationService
  ) {}

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
  @Post('validate-issue')
  @HttpCode(200)
  validateIssue(
    @Body(new ZodValidationPipe(IssueValidationRequestSchema)) input: IssueValidationRequest
  ) {
    return this.issueValidations.start(input);
  }
  @Post('validation-status')
  @HttpCode(200)
  validationStatus(
    @Body(new ZodValidationPipe(IssueValidationStatusSchema)) input: IssueValidationStatusRequest
  ) {
    return this.issueValidations.status(input);
  }
  @Post('validation-stop')
  @HttpCode(200)
  validationStop(
    @Body(new ZodValidationPipe(IssueValidationStopSchema)) input: IssueValidationStopRequest
  ) {
    return this.issueValidations.stop(input);
  }
  @Post('validations')
  @HttpCode(200)
  validations(
    @Body(new ZodValidationPipe(IssueValidationStatusSchema)) input: IssueValidationStatusRequest
  ) {
    return this.issueValidations.stored(input);
  }
  @Post('validation-delete')
  @HttpCode(200)
  validationDelete(
    @Body(new ZodValidationPipe(IssueValidationStopSchema)) input: IssueValidationStopRequest
  ) {
    return this.issueValidations.delete(input);
  }
  @Post('validation-mark-viewed')
  @HttpCode(200)
  validationMarkViewed(
    @Body(new ZodValidationPipe(IssueValidationStopSchema)) input: IssueValidationStopRequest
  ) {
    return this.issueValidations.markViewed(input);
  }
}
