import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { PipelineApplicationService } from './pipeline-application.service.js';
import {
  PipelineAddSchema,
  PipelineDeleteSchema,
  PipelineProjectSchema,
  PipelineReorderSchema,
  PipelineSaveSchema,
  PipelineUpdateSchema,
  type PipelineAddRequest,
  type PipelineDeleteRequest,
  type PipelineProjectRequest,
  type PipelineReorderRequest,
  type PipelineSaveRequest,
  type PipelineUpdateRequest,
} from './pipeline.schemas.js';

@Controller('pipeline')
@UseGuards(AllowedPathGuard)
export class PipelineController {
  constructor(
    @Inject(PipelineApplicationService) private readonly pipeline: PipelineApplicationService
  ) {}

  @Post('config')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  get(@Body(new ZodValidationPipe(PipelineProjectSchema)) body: PipelineProjectRequest) {
    return this.pipeline.get(body);
  }

  @Post('config/save')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  save(@Body(new ZodValidationPipe(PipelineSaveSchema)) body: PipelineSaveRequest) {
    return this.pipeline.save(body);
  }

  @Post('steps/add')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  add(@Body(new ZodValidationPipe(PipelineAddSchema)) body: PipelineAddRequest) {
    return this.pipeline.add(body);
  }

  @Post('steps/update')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  update(@Body(new ZodValidationPipe(PipelineUpdateSchema)) body: PipelineUpdateRequest) {
    return this.pipeline.update(body);
  }

  @Post('steps/delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  delete(@Body(new ZodValidationPipe(PipelineDeleteSchema)) body: PipelineDeleteRequest) {
    return this.pipeline.delete(body);
  }

  @Post('steps/reorder')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  reorder(@Body(new ZodValidationPipe(PipelineReorderSchema)) body: PipelineReorderRequest) {
    return this.pipeline.reorder(body);
  }
}
