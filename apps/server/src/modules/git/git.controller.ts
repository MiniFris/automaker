import {
  GitDetailsResponseSchema,
  GitDiffsResponseSchema,
  GitEnhancedStatusResponseSchema,
  GitEnvironmentResponseSchema,
  GitFileDiffResponseSchema,
  GitStageFilesResponseSchema,
} from '@automaker/contracts/domains/git-responses';
import { Body, Controller, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { GitApplicationService } from './git-application.service.js';
import {
  GitDetailsSchema,
  GitFileSchema,
  GitProjectSchema,
  GitStageFilesSchema,
  type GitDetailsRequest,
  type GitFileRequest,
  type GitProjectRequest,
  type GitStageFilesRequest,
} from './git.schemas.js';

@Controller('git')
@UseGuards(AllowedPathGuard)
export class GitController {
  constructor(@Inject(GitApplicationService) private readonly git: GitApplicationService) {}

  @Post('environment')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async environment(@Body(new ZodValidationPipe(GitProjectSchema)) body: GitProjectRequest) {
    return GitEnvironmentResponseSchema.parse(await this.git.environment(body));
  }

  @Post('diffs')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async diffs(
    @Body(new ZodValidationPipe(GitProjectSchema)) body: GitProjectRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return GitDiffsResponseSchema.parse(
      await this.cancel(response, (signal) => this.git.diffs(body, signal))
    );
  }

  @Post('file-diff')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async fileDiff(
    @Body(new ZodValidationPipe(GitFileSchema)) body: GitFileRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return GitFileDiffResponseSchema.parse(
      await this.cancel(response, (signal) => this.git.fileDiff(body, signal))
    );
  }

  @Post('stage-files')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async stageFiles(
    @Body(new ZodValidationPipe(GitStageFilesSchema)) body: GitStageFilesRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return GitStageFilesResponseSchema.parse(
      await this.cancel(response, (signal) => this.git.stageFiles(body, signal))
    );
  }

  @Post('details')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async details(
    @Body(new ZodValidationPipe(GitDetailsSchema)) body: GitDetailsRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return GitDetailsResponseSchema.parse(
      await this.cancel(response, (signal) => this.git.details(body, signal))
    );
  }

  @Post('enhanced-status')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async enhancedStatus(
    @Body(new ZodValidationPipe(GitProjectSchema)) body: GitProjectRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return GitEnhancedStatusResponseSchema.parse(
      await this.cancel(response, (signal) => this.git.enhancedStatus(body, signal))
    );
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
