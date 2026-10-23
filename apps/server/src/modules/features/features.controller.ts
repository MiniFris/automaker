import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { FeatureQueryService } from './feature-query.service.js';
import { FeatureCommandService } from './feature-command.service.js';
import { FeatureTitleService } from './feature-title.service.js';
import {
  FeatureBulkDeleteSchema,
  FeatureBulkUpdateSchema,
  FeatureConflictCheckSchema,
  FeatureCreateSchema,
  FeatureExportSchema,
  FeatureImportSchema,
  FeatureListSchema,
  FeatureTitleSchema,
  FeatureUpdateSchema,
  OrphanBulkResolveSchema,
  OrphanResolveSchema,
  ProjectFeatureSchema,
  type FeatureBulkDeleteRequest,
  type FeatureBulkUpdateRequest,
  type FeatureConflictCheckRequest,
  type FeatureCreateRequest,
  type FeatureExportRequest,
  type FeatureImportRequest,
  type FeatureListRequest,
  type FeatureTitleRequest,
  type FeatureUpdateRequest,
  type OrphanBulkResolveRequest,
  type OrphanResolveRequest,
  type ProjectFeatureRequest,
} from './feature.schemas.js';

@Controller('features')
@UseGuards(AllowedPathGuard)
export class FeaturesController {
  constructor(
    @Inject(FeatureQueryService) private readonly queries: FeatureQueryService,
    @Inject(FeatureCommandService) private readonly commands: FeatureCommandService,
    @Inject(FeatureTitleService) private readonly titles: FeatureTitleService
  ) {}

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

  @Post('create')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  create(@Body(new ZodValidationPipe(FeatureCreateSchema)) input: FeatureCreateRequest) {
    return this.commands.create(input);
  }

  @Post('update')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  update(@Body(new ZodValidationPipe(FeatureUpdateSchema)) input: FeatureUpdateRequest) {
    return this.commands.update(input);
  }

  @Post('delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  remove(@Body(new ZodValidationPipe(ProjectFeatureSchema)) input: ProjectFeatureRequest) {
    return this.commands.remove(input.projectPath, input.featureId);
  }

  @Post('bulk-update')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  bulkUpdate(
    @Body(new ZodValidationPipe(FeatureBulkUpdateSchema)) input: FeatureBulkUpdateRequest
  ) {
    return this.commands.bulkUpdate(input);
  }

  @Post('bulk-delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  bulkDelete(
    @Body(new ZodValidationPipe(FeatureBulkDeleteSchema)) input: FeatureBulkDeleteRequest
  ) {
    return this.commands.bulkDelete(input);
  }

  @Post('import')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  import(@Body(new ZodValidationPipe(FeatureImportSchema)) input: FeatureImportRequest) {
    return this.commands.import(input);
  }

  @Post('orphaned/resolve')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  resolveOrphan(@Body(new ZodValidationPipe(OrphanResolveSchema)) input: OrphanResolveRequest) {
    return this.commands.resolveOrphan(input);
  }

  @Post('orphaned/bulk-resolve')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  bulkResolveOrphans(
    @Body(new ZodValidationPipe(OrphanBulkResolveSchema)) input: OrphanBulkResolveRequest
  ) {
    return this.commands.bulkResolveOrphans(input);
  }

  @Post('generate-title')
  @HttpCode(200)
  generateTitle(
    @Body(new ZodValidationPipe(FeatureTitleSchema)) input: FeatureTitleRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.withCancellation(response, (controller) =>
      this.titles.generate(input.description, input.projectPath, controller)
    );
  }

  private async withCancellation<T>(
    response: Response,
    operation: (controller: AbortController) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const close = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', close);
    try {
      return await operation(controller);
    } finally {
      response.off('close', close);
    }
  }
}
