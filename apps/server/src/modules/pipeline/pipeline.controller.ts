import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { PipelineApplicationService } from './pipeline-application.service.js';
import {
  PipelineConfigResponseSchema,
  PipelineMutationResponseSchema,
  PipelineCreatedStepResponseSchema,
  PipelineUpdatedStepResponseSchema,
} from '@automaker/contracts/domains/pipeline';
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
  async get(@Body(new ZodValidationPipe(PipelineProjectSchema)) body: PipelineProjectRequest) {
    return PipelineConfigResponseSchema.parse(await this.pipeline.get(body));
  }

  @Post('config/save')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async save(@Body(new ZodValidationPipe(PipelineSaveSchema)) body: PipelineSaveRequest) {
    return PipelineMutationResponseSchema.parse(await this.pipeline.save(body));
  }

  @Post('steps/add')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async add(@Body(new ZodValidationPipe(PipelineAddSchema)) body: PipelineAddRequest) {
    return PipelineCreatedStepResponseSchema.parse(await this.pipeline.add(body));
  }

  @Post('steps/update')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async update(@Body(new ZodValidationPipe(PipelineUpdateSchema)) body: PipelineUpdateRequest) {
    return PipelineUpdatedStepResponseSchema.parse(await this.pipeline.update(body));
  }

  @Post('steps/delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async delete(@Body(new ZodValidationPipe(PipelineDeleteSchema)) body: PipelineDeleteRequest) {
    return PipelineMutationResponseSchema.parse(await this.pipeline.delete(body));
  }

  @Post('steps/reorder')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async reorder(@Body(new ZodValidationPipe(PipelineReorderSchema)) body: PipelineReorderRequest) {
    return PipelineMutationResponseSchema.parse(await this.pipeline.reorder(body));
  }
}
