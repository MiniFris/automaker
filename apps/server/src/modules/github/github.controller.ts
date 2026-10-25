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
  GithubRemoteResponseSchema,
  GithubIssuesResponseSchema,
  GithubPRsResponseSchema,
  GithubIssueCommentsResponseSchema,
  GithubReviewCommentsResponseSchema,
  GithubResolveThreadResponseSchema,
  IssueValidationStartResponseSchema,
  IssueValidationStatusResponseSchema,
  IssueValidationStopResponseSchema,
  IssueValidationsResponseSchema,
  IssueValidationDeleteResponseSchema,
  IssueValidationViewedResponseSchema,
} from '@automaker/contracts/domains/integration-responses';
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
  async checkRemote(@Body(new ZodValidationPipe(GithubProjectSchema)) input: GithubProjectRequest) {
    return GithubRemoteResponseSchema.parse(await this.discovery.remote(input.projectPath));
  }
  @Post('issues')
  @HttpCode(200)
  async issues(@Body(new ZodValidationPipe(GithubProjectSchema)) input: GithubProjectRequest) {
    return GithubIssuesResponseSchema.parse(await this.discovery.issues(input.projectPath));
  }
  @Post('prs')
  @HttpCode(200)
  async prs(@Body(new ZodValidationPipe(GithubProjectSchema)) input: GithubProjectRequest) {
    return GithubPRsResponseSchema.parse(await this.discovery.prs(input.projectPath));
  }
  @Post('issue-comments')
  @HttpCode(200)
  async issueComments(
    @Body(new ZodValidationPipe(GithubIssueCommentsSchema)) input: GithubIssueCommentsRequest
  ) {
    return GithubIssueCommentsResponseSchema.parse(await this.reviews.issueComments(input));
  }
  @Post('pr-review-comments')
  @HttpCode(200)
  async prReviewComments(
    @Body(new ZodValidationPipe(GithubReviewCommentsSchema)) input: GithubReviewCommentsRequest
  ) {
    return GithubReviewCommentsResponseSchema.parse(await this.reviews.reviewComments(input));
  }
  @Post('resolve-pr-comment')
  @HttpCode(200)
  async resolvePrComment(
    @Body(new ZodValidationPipe(GithubResolveThreadSchema)) input: GithubResolveThreadRequest
  ) {
    return GithubResolveThreadResponseSchema.parse(await this.reviews.resolve(input));
  }
  @Post('validate-issue')
  @HttpCode(200)
  async validateIssue(
    @Body(new ZodValidationPipe(IssueValidationRequestSchema)) input: IssueValidationRequest
  ) {
    return IssueValidationStartResponseSchema.parse(await this.issueValidations.start(input));
  }
  @Post('validation-status')
  @HttpCode(200)
  async validationStatus(
    @Body(new ZodValidationPipe(IssueValidationStatusSchema)) input: IssueValidationStatusRequest
  ) {
    return IssueValidationStatusResponseSchema.parse(await this.issueValidations.status(input));
  }
  @Post('validation-stop')
  @HttpCode(200)
  async validationStop(
    @Body(new ZodValidationPipe(IssueValidationStopSchema)) input: IssueValidationStopRequest
  ) {
    return IssueValidationStopResponseSchema.parse(await this.issueValidations.stop(input));
  }
  @Post('validations')
  @HttpCode(200)
  async validations(
    @Body(new ZodValidationPipe(IssueValidationStatusSchema)) input: IssueValidationStatusRequest
  ) {
    return IssueValidationsResponseSchema.parse(await this.issueValidations.stored(input));
  }
  @Post('validation-delete')
  @HttpCode(200)
  async validationDelete(
    @Body(new ZodValidationPipe(IssueValidationStopSchema)) input: IssueValidationStopRequest
  ) {
    return IssueValidationDeleteResponseSchema.parse(await this.issueValidations.delete(input));
  }
  @Post('validation-mark-viewed')
  @HttpCode(200)
  async validationMarkViewed(
    @Body(new ZodValidationPipe(IssueValidationStopSchema)) input: IssueValidationStopRequest
  ) {
    return IssueValidationViewedResponseSchema.parse(await this.issueValidations.markViewed(input));
  }
}
