import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { GithubReviewService } from './github-review.service.js';
import {
  GithubIssueCommentsSchema,
  GithubReviewCommentsSchema,
  GithubResolveThreadSchema,
  type GithubIssueCommentsRequest,
  type GithubReviewCommentsRequest,
  type GithubResolveThreadRequest,
} from './github-review.schemas.js';
import { IssueValidationService } from './issue-validation.service.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { GithubDiscoveryService } from './github-discovery.service.js';
import { GithubProjectSchema, type GithubProjectRequest } from './github-discovery.schemas.js';
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
    @Inject(GithubReviewService) private readonly reviews: GithubReviewService,
    @Inject(IssueValidationService) private readonly issueValidations: IssueValidationService,
    @Inject(GithubDiscoveryService) private readonly discovery: GithubDiscoveryService
  ) {}

  @Post('check-remote')
  @HttpCode(200)
  checkRemote(@Body(new ZodValidationPipe(GithubProjectSchema)) input: GithubProjectRequest) {
    return this.discovery.remote(input.projectPath);
  }
  @Post('issues')
  @HttpCode(200)
  issues(@Body(new ZodValidationPipe(GithubProjectSchema)) input: GithubProjectRequest) {
    return this.discovery.issues(input.projectPath);
  }
  @Post('prs')
  @HttpCode(200)
  prs(@Body(new ZodValidationPipe(GithubProjectSchema)) input: GithubProjectRequest) {
    return this.discovery.prs(input.projectPath);
  }
  @Post('issue-comments')
  @HttpCode(200)
  issueComments(
    @Body(new ZodValidationPipe(GithubIssueCommentsSchema)) input: GithubIssueCommentsRequest
  ) {
    return this.reviews.issueComments(input);
  }
  @Post('pr-review-comments')
  @HttpCode(200)
  prReviewComments(
    @Body(new ZodValidationPipe(GithubReviewCommentsSchema)) input: GithubReviewCommentsRequest
  ) {
    return this.reviews.reviewComments(input);
  }
  @Post('resolve-pr-comment')
  @HttpCode(200)
  resolvePrComment(
    @Body(new ZodValidationPipe(GithubResolveThreadSchema)) input: GithubResolveThreadRequest
  ) {
    return this.reviews.resolve(input);
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
