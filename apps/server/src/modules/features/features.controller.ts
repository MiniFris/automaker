import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { FeatureQueryService } from './feature-query.service.js';
import {
  FeatureConflictCheckSchema,
  FeatureExportSchema,
  FeatureListSchema,
  ProjectFeatureSchema,
  type FeatureConflictCheckRequest,
  type FeatureExportRequest,
  type FeatureListRequest,
  type ProjectFeatureRequest,
} from './feature.schemas.js';

@Controller('features')
@UseGuards(AllowedPathGuard)
export class FeaturesController {
  constructor(@Inject(FeatureQueryService) private readonly queries: FeatureQueryService) {}

  @Get('list')
  @AllowedPathFields('projectPath')
  listGet(@Query(new ZodValidationPipe(FeatureListSchema)) input: FeatureListRequest) {
    return this.queries.list(input.projectPath);
  }

  @Post('list')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  listPost(@Body(new ZodValidationPipe(FeatureListSchema)) input: FeatureListRequest) {
    return this.queries.list(input.projectPath);
  }

  @Post('get')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  get(@Body(new ZodValidationPipe(ProjectFeatureSchema)) input: ProjectFeatureRequest) {
    return this.queries.get(input.projectPath, input.featureId);
  }

  @Post('agent-output')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  agentOutput(@Body(new ZodValidationPipe(ProjectFeatureSchema)) input: ProjectFeatureRequest) {
    return this.queries.agentOutput(input.projectPath, input.featureId);
  }

  @Post('raw-output')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  rawOutput(@Body(new ZodValidationPipe(ProjectFeatureSchema)) input: ProjectFeatureRequest) {
    return this.queries.rawOutput(input.projectPath, input.featureId);
  }

  @Post('export')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  export(@Body(new ZodValidationPipe(FeatureExportSchema)) input: FeatureExportRequest) {
    return this.queries.export(input);
  }

  @Post('check-conflicts')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  conflicts(
    @Body(new ZodValidationPipe(FeatureConflictCheckSchema)) input: FeatureConflictCheckRequest
  ) {
    return this.queries.conflicts(input);
  }

  @Post('orphaned')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  orphaned(@Body(new ZodValidationPipe(FeatureListSchema)) input: FeatureListRequest) {
    return this.queries.orphaned(input.projectPath);
  }
}
