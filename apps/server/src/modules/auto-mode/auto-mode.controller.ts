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
  mergeEnvironmentFeature(
    @Body(new ZodValidationPipe(AutoModeMergeSchema)) body: AutoModeMergeRequest
  ) {
    return this.commands.mergeFeature(body, true);
  }
  @Post('merge-ssh-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  mergeSshFeature(@Body(new ZodValidationPipe(AutoModeMergeSchema)) body: AutoModeMergeRequest) {
    return this.commands.mergeFeature(body, false);
  }
  @Post('start')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  start(@Body(new ZodValidationPipe(AutoModeStartSchema)) body: AutoModeStartRequest) {
    return this.commands.start(body);
  }
  @Post('stop')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  stop(@Body(new ZodValidationPipe(AutoModeBranchSchema)) body: AutoModeBranchRequest) {
    return this.commands.stop(body);
  }
  @Post('stop-feature')
  @HttpCode(200)
  stopFeature(
    @Body(new ZodValidationPipe(AutoModeStopFeatureSchema)) body: AutoModeStopFeatureRequest
  ) {
    return this.commands.stopFeature(body);
  }
  @Post('status')
  @HttpCode(200)
  @AllowedPathFields('projectPath?')
  status(@Body(new ZodValidationPipe(AutoModeStatusSchema)) body: AutoModeStatusRequest) {
    return this.commands.status(body);
  }
  @Post('run-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  runFeature(@Body(new ZodValidationPipe(AutoModeExecuteSchema)) body: AutoModeExecuteRequest) {
    return this.commands.runFeature(body);
  }
  @Post('verify-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  verifyFeature(@Body(new ZodValidationPipe(AutoModeFeatureSchema)) body: AutoModeFeatureRequest) {
    return this.commands.verifyFeature(body);
  }
  @Post('resume-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  resumeFeature(@Body(new ZodValidationPipe(AutoModeExecuteSchema)) body: AutoModeExecuteRequest) {
    return this.commands.resumeFeature(body);
  }
  @Post('context-exists')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  contextExists(@Body(new ZodValidationPipe(AutoModeFeatureSchema)) body: AutoModeFeatureRequest) {
    return this.commands.contextExists(body);
  }
  @Post('analyze-project')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  analyzeProject(@Body(new ZodValidationPipe(AutoModeProjectSchema)) body: AutoModeProjectRequest) {
    return this.commands.analyzeProject(body);
  }
  @Post('follow-up-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'imagePaths?[]')
  followUpFeature(
    @Body(new ZodValidationPipe(AutoModeFollowUpSchema)) body: AutoModeFollowUpRequest
  ) {
    return this.commands.followUpFeature(body);
  }
  @Post('commit-feature')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath?')
  commitFeature(@Body(new ZodValidationPipe(AutoModeCommitSchema)) body: AutoModeCommitRequest) {
    return this.commands.commitFeature(body);
  }
  @Post('approve-plan')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  approvePlan(
    @Body(new ZodValidationPipe(PlanApprovalDecisionRequestSchema))
    body: PlanApprovalDecisionRequest
  ) {
    return this.commands.approvePlan(body);
  }
  @Post('pending-plan-approval')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  pendingPlanApproval(
    @Body(new ZodValidationPipe(PendingPlanApprovalRequestSchema)) body: PendingPlanApprovalRequest
  ) {
    return this.commands.pendingPlanApproval(body);
  }
  @Post('resume-interrupted')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  resumeInterrupted(
    @Body(new ZodValidationPipe(AutoModeProjectSchema)) body: AutoModeProjectRequest
  ) {
    return this.commands.resumeInterrupted(body);
  }
  @Post('reconcile')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  reconcile(@Body(new ZodValidationPipe(AutoModeProjectSchema)) body: AutoModeProjectRequest) {
    return this.commands.reconcile(body);
  }
}
