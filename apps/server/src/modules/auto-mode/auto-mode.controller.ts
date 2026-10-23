import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  PendingPlanApprovalRequestSchema,
  type PendingPlanApprovalRequest,
} from '@automaker/contracts';
import type { Request, Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { AutoModeHandlersService, type AutoModeHandlerName } from './auto-mode-handlers.service.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import type { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';

@Controller('auto-mode')
@UseGuards(AllowedPathGuard)
export class AutoModeController {
  constructor(
    @Inject(AutoModeHandlersService) private readonly handlers: AutoModeHandlersService,
    @Inject(LEGACY_SERVICES.autoMode) private readonly autoMode: AutoModeServiceCompat
  ) {}

  private run(name: AutoModeHandlerName, request: Request, response: Response) {
    return this.handlers.run(name, request, response);
  }

  @Post('merge-environment-feature') @AllowedPathFields('projectPath') mergeEnvironmentFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('mergeEnvironmentFeature', q, s);
  }
  @Post('merge-ssh-feature') @AllowedPathFields('projectPath') mergeSshFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('mergeSshFeature', q, s);
  }
  @Post('start') @AllowedPathFields('projectPath') start(@Req() q: Request, @Res() s: Response) {
    return this.run('start', q, s);
  }
  @Post('stop') @AllowedPathFields('projectPath') stop(@Req() q: Request, @Res() s: Response) {
    return this.run('stop', q, s);
  }
  @Post('stop-feature') stopFeature(@Req() q: Request, @Res() s: Response) {
    return this.run('stopFeature', q, s);
  }
  @Post('status') @AllowedPathFields('projectPath?') status(@Req() q: Request, @Res() s: Response) {
    return this.run('status', q, s);
  }
  @Post('run-feature') @AllowedPathFields('projectPath') runFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('runFeature', q, s);
  }
  @Post('verify-feature') @AllowedPathFields('projectPath') verifyFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('verifyFeature', q, s);
  }
  @Post('resume-feature') @AllowedPathFields('projectPath') resumeFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('resumeFeature', q, s);
  }
  @Post('context-exists') @AllowedPathFields('projectPath') contextExists(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('contextExists', q, s);
  }
  @Post('analyze-project') @AllowedPathFields('projectPath') analyzeProject(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('analyzeProject', q, s);
  }
  @Post('follow-up-feature') @AllowedPathFields('projectPath', 'imagePaths[]') followUpFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('followUpFeature', q, s);
  }
  @Post('commit-feature') @AllowedPathFields('projectPath', 'worktreePath?') commitFeature(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('commitFeature', q, s);
  }
  @Post('approve-plan') @AllowedPathFields('projectPath') approvePlan(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('approvePlan', q, s);
  }

  @Post('pending-plan-approval')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async pendingPlanApproval(
    @Body(new ZodValidationPipe(PendingPlanApprovalRequestSchema))
    body: PendingPlanApprovalRequest
  ) {
    return {
      success: true,
      approval: await this.autoMode.getPendingPlanApproval(body.projectPath, body.featureId),
    };
  }
  @Post('resume-interrupted') @AllowedPathFields('projectPath') resumeInterrupted(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('resumeInterrupted', q, s);
  }
  @Post('reconcile') @AllowedPathFields('projectPath') reconcile(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('reconcile', q, s);
  }
}
