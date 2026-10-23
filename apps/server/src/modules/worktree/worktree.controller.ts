import { Body, Controller, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { WorktreeApplicationService } from './worktree-application.service.js';
import {
  WorktreeBranchesSchema,
  WorktreeBranchCommitLogSchema,
  WorktreeCommitLogSchema,
  WorktreeFeatureSchema,
  WorktreeFileSchema,
  WorktreePathSchema,
  WorktreeProjectSchema,
  type WorktreeBranchesRequest,
  type WorktreeBranchCommitLogRequest,
  type WorktreeCommitLogRequest,
  type WorktreeFeatureRequest,
  type WorktreeFileRequest,
  type WorktreePathRequest,
  type WorktreeProjectRequest,
} from './worktree.schemas.js';

@Controller('worktree')
@UseGuards(AllowedPathGuard)
export class WorktreeController {
  constructor(
    @Inject(WorktreeApplicationService) private readonly worktrees: WorktreeApplicationService
  ) {}

  @Post('environment')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  environment(@Body(new ZodValidationPipe(WorktreeProjectSchema)) body: WorktreeProjectRequest) {
    return this.worktrees.environment(body);
  }

  @Post('list')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  list(
    @Body(new ZodValidationPipe(WorktreeProjectSchema)) body: WorktreeProjectRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.list(body, signal));
  }

  @Post('info')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  info(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.info(body, signal));
  }

  @Post('status')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  status(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.status(body, signal));
  }

  @Post('diffs')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  diffs(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.diffs(body, signal));
  }

  @Post('file-diff')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  fileDiff(
    @Body(new ZodValidationPipe(WorktreeFileSchema)) body: WorktreeFileRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.fileDiff(body, signal));
  }

  @Post('check-changes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  checkChanges(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.checkChanges(body, signal));
  }

  @Post('list-branches')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  listBranches(
    @Body(new ZodValidationPipe(WorktreeBranchesSchema)) body: WorktreeBranchesRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.listBranches(body, signal));
  }

  @Post('list-remotes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  listRemotes(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.listRemotes(body, signal));
  }

  @Post('commit-log')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  commitLog(
    @Body(new ZodValidationPipe(WorktreeCommitLogSchema)) body: WorktreeCommitLogRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.commitLog(body, signal));
  }

  @Post('branch-commit-log')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  branchCommitLog(
    @Body(new ZodValidationPipe(WorktreeBranchCommitLogSchema))
    body: WorktreeBranchCommitLogRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.branchCommitLog(body, signal));
  }

  private async cancel<T>(response: Response, operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const close = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', close);
    try {
      return await operation(controller.signal);
    } finally {
      response.off('close', close);
    }
  }
}
