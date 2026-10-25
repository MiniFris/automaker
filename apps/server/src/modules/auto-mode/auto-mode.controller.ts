import {
  AutoModeAcceptedResponseSchema,
  AutoModeApprovalResponseSchema,
  AutoModeCommitResponseSchema,
  AutoModeContextResponseSchema,
  AutoModeMessageResponseSchema,
  AutoModeReconcileResponseSchema,
  AutoModeStartResponseSchema,
  AutoModeStatusResponseSchema,
  AutoModeStopFeatureResponseSchema,
  AutoModeStopResponseSchema,
  AutoModeVerificationResponseSchema,
  PendingPlanApprovalResponseSchema,
} from '@automaker/contracts/domains/auto-mode-responses';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  PendingPlanApprovalRequestSchema,
  PlanApprovalDecisionRequestSchema,
  type PendingPlanApprovalRequest,
  type PlanApprovalDecisionRequest,
} from '@automaker/contracts';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { AutoModeApplicationService } from './auto-mode-application.service.js';
import {
  AutoModeBranchSchema,
  AutoModeCommitSchema,
  AutoModeExecuteSchema,
  AutoModeFeatureSchema,
  AutoModeFollowUpSchema,
  AutoModeMergeSchema,
  AutoModeProjectSchema,
  AutoModeStartSchema,
  AutoModeStatusSchema,
  AutoModeStopFeatureSchema,
  type AutoModeBranchRequest,
  type AutoModeCommitRequest,
  type AutoModeExecuteRequest,
  type AutoModeFeatureRequest,
  type AutoModeFollowUpRequest,
  type AutoModeMergeRequest,
  type AutoModeProjectRequest,
  type AutoModeStartRequest,
  type AutoModeStatusRequest,
  type AutoModeStopFeatureRequest,
} from './auto-mode.schemas.js';

@Controller('auto-mode')
@UseGuards(AllowedPathGuard)
export class AutoModeController {
  constructor(
    @Inject(AutoModeApplicationService) private readonly commands: AutoModeApplicationService
  ) {}
  @Post('merge-environment-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async mergeEnvironmentFeature(
    @Body(new ZodValidationPipe(AutoModeMergeSchema)) body: AutoModeMergeRequest
  ) {
    return AutoModeAcceptedResponseSchema.parse(await this.commands.mergeFeature(body, true));
  }
  @Post('merge-ssh-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async mergeSshFeature(
    @Body(new ZodValidationPipe(AutoModeMergeSchema)) body: AutoModeMergeRequest
  ) {
    return AutoModeAcceptedResponseSchema.parse(await this.commands.mergeFeature(body, false));
  }
  @Post('start')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async start(@Body(new ZodValidationPipe(AutoModeStartSchema)) body: AutoModeStartRequest) {
    return AutoModeStartResponseSchema.parse(await this.commands.start(body));
  }
  @Post('stop')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async stop(@Body(new ZodValidationPipe(AutoModeBranchSchema)) body: AutoModeBranchRequest) {
    return AutoModeStopResponseSchema.parse(await this.commands.stop(body));
  }
  @Post('stop-feature')
  @HttpCode(200)
  async stopFeature(
    @Body(new ZodValidationPipe(AutoModeStopFeatureSchema)) body: AutoModeStopFeatureRequest
  ) {
    return AutoModeStopFeatureResponseSchema.parse(await this.commands.stopFeature(body));
  }
  @Post('status')
  @HttpCode(200)
  @AllowedPathFields('projectPath?')
  async status(@Body(new ZodValidationPipe(AutoModeStatusSchema)) body: AutoModeStatusRequest) {
    return AutoModeStatusResponseSchema.parse(await this.commands.status(body));
  }
  @Post('run-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async runFeature(
    @Body(new ZodValidationPipe(AutoModeExecuteSchema)) body: AutoModeExecuteRequest
  ) {
    return AutoModeAcceptedResponseSchema.parse(await this.commands.runFeature(body));
  }
  @Post('verify-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async verifyFeature(
    @Body(new ZodValidationPipe(AutoModeFeatureSchema)) body: AutoModeFeatureRequest
  ) {
    return AutoModeVerificationResponseSchema.parse(await this.commands.verifyFeature(body));
  }
  @Post('resume-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async resumeFeature(
    @Body(new ZodValidationPipe(AutoModeExecuteSchema)) body: AutoModeExecuteRequest
  ) {
    return AutoModeAcceptedResponseSchema.parse(await this.commands.resumeFeature(body));
  }
  @Post('context-exists')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async contextExists(
    @Body(new ZodValidationPipe(AutoModeFeatureSchema)) body: AutoModeFeatureRequest
  ) {
    return AutoModeContextResponseSchema.parse(await this.commands.contextExists(body));
  }
  @Post('analyze-project')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async analyzeProject(
    @Body(new ZodValidationPipe(AutoModeProjectSchema)) body: AutoModeProjectRequest
  ) {
    return AutoModeMessageResponseSchema.parse(await this.commands.analyzeProject(body));
  }
  @Post('follow-up-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'imagePaths?[]')
  async followUpFeature(
    @Body(new ZodValidationPipe(AutoModeFollowUpSchema)) body: AutoModeFollowUpRequest
  ) {
    return AutoModeAcceptedResponseSchema.parse(await this.commands.followUpFeature(body));
  }
  @Post('commit-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath?')
  async commitFeature(
    @Body(new ZodValidationPipe(AutoModeCommitSchema)) body: AutoModeCommitRequest
  ) {
    return AutoModeCommitResponseSchema.parse(await this.commands.commitFeature(body));
  }
  @Post('approve-plan')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async approvePlan(
    @Body(new ZodValidationPipe(PlanApprovalDecisionRequestSchema))
    body: PlanApprovalDecisionRequest
  ) {
    return AutoModeApprovalResponseSchema.parse(await this.commands.approvePlan(body));
  }
  @Post('pending-plan-approval')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async pendingPlanApproval(
    @Body(new ZodValidationPipe(PendingPlanApprovalRequestSchema)) body: PendingPlanApprovalRequest
  ) {
    return PendingPlanApprovalResponseSchema.parse(await this.commands.pendingPlanApproval(body));
  }
  @Post('resume-interrupted')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async resumeInterrupted(
    @Body(new ZodValidationPipe(AutoModeProjectSchema)) body: AutoModeProjectRequest
  ) {
    return AutoModeMessageResponseSchema.parse(await this.commands.resumeInterrupted(body));
  }
  @Post('reconcile')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async reconcile(
    @Body(new ZodValidationPipe(AutoModeProjectSchema)) body: AutoModeProjectRequest
  ) {
    return AutoModeReconcileResponseSchema.parse(await this.commands.reconcile(body));
  }
}
