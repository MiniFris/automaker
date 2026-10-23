import { Inject, Injectable } from '@nestjs/common';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { PipelineService } from '../../services/pipeline-service.js';
import type {
  PipelineAddRequest,
  PipelineDeleteRequest,
  PipelineProjectRequest,
  PipelineReorderRequest,
  PipelineSaveRequest,
  PipelineUpdateRequest,
} from './pipeline.schemas.js';

@Injectable()
export class PipelineApplicationService {
  constructor(@Inject(LEGACY_SERVICES.pipeline) private readonly pipeline: PipelineService) {}

  async get(input: PipelineProjectRequest) {
    return {
      success: true as const,
      config: await this.pipeline.getPipelineConfig(input.projectPath),
    };
  }

  async save(input: PipelineSaveRequest) {
    await this.pipeline.savePipelineConfig(input.projectPath, input.config);
    return { success: true as const };
  }

  async add(input: PipelineAddRequest) {
    return {
      success: true as const,
      step: await this.pipeline.addStep(input.projectPath, input.step),
    };
  }

  async update(input: PipelineUpdateRequest) {
    return {
      success: true as const,
      step: await this.pipeline.updateStep(input.projectPath, input.stepId, input.updates),
    };
  }

  async delete(input: PipelineDeleteRequest) {
    await this.pipeline.deleteStep(input.projectPath, input.stepId);
    return { success: true as const };
  }

  async reorder(input: PipelineReorderRequest) {
    await this.pipeline.reorderSteps(input.projectPath, input.stepIds);
    return { success: true as const };
  }
}
