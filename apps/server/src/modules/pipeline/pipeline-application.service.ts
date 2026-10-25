import type {
  PipelineAddInput,
  PipelineDeleteInput,
  PipelineProjectInput,
  PipelineReorderInput,
  PipelineSaveInput,
  PipelineUpdateInput,
} from './application.inputs.js';

import { PipelineService } from '../../services/pipeline-service.js';

export class PipelineApplicationService {
  constructor(private readonly pipeline: PipelineService) {}

  async get(input: PipelineProjectInput) {
    return {
      success: true as const,
      config: await this.pipeline.getPipelineConfig(input.projectPath),
    };
  }

  async save(input: PipelineSaveInput) {
    await this.pipeline.savePipelineConfig(input.projectPath, input.config);
    return { success: true as const };
  }

  async add(input: PipelineAddInput) {
    return {
      success: true as const,
      step: await this.pipeline.addStep(input.projectPath, input.step),
    };
  }

  async update(input: PipelineUpdateInput) {
    return {
      success: true as const,
      step: await this.pipeline.updateStep(input.projectPath, input.stepId, input.updates),
    };
  }

  async delete(input: PipelineDeleteInput) {
    await this.pipeline.deleteStep(input.projectPath, input.stepId);
    return { success: true as const };
  }

  async reorder(input: PipelineReorderInput) {
    await this.pipeline.reorderSteps(input.projectPath, input.stepIds);
    return { success: true as const };
  }
}
