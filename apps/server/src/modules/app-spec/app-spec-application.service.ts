import { Inject, Injectable } from '@nestjs/common';
import { EVENT_BUS, type EventBus } from '../../core/eventing/index.js';
import { APP_SPEC_WORKFLOW_PORT, type AppSpecWorkflowPort } from './app-spec-workflow.port.js';
import { AppSpecJobRegistry } from './app-spec-job.registry.js';
import type {
  AppSpecCreateRequest,
  AppSpecFeaturesRequest,
  AppSpecGenerateRequest,
} from './app-spec.schemas.js';

@Injectable()
export class AppSpecApplicationService {
  constructor(
    @Inject(APP_SPEC_WORKFLOW_PORT) private readonly workflow: AppSpecWorkflowPort,
    @Inject(AppSpecJobRegistry) private readonly jobs: AppSpecJobRegistry,
    @Inject(EVENT_BUS) private readonly events: EventBus
  ) {}

  create(input: AppSpecCreateRequest) {
    return this.start(input.projectPath, 'spec_regeneration', (abortController) =>
      this.workflow.generate({
        projectPath: input.projectPath,
        source: input.projectOverview,
        generateFeatures: input.generateFeatures,
        analyzeProject: input.analyzeProject,
        maxFeatures: input.maxFeatures,
        abortController,
      })
    );
  }

  generate(input: AppSpecGenerateRequest) {
    return this.start(input.projectPath, 'spec_regeneration', (abortController) =>
      this.workflow.generate({
        projectPath: input.projectPath,
        source: input.projectDefinition,
        generateFeatures: input.generateFeatures,
        analyzeProject: input.analyzeProject,
        maxFeatures: input.maxFeatures,
        abortController,
      })
    );
  }

  generateFeatures(input: AppSpecFeaturesRequest) {
    return this.start(input.projectPath, 'feature_generation', (abortController) =>
      this.workflow.generateFeatures(input.projectPath, input.maxFeatures, abortController)
    );
  }

  sync(projectPath: string) {
    return this.start(projectPath, 'sync', (abortController) =>
      this.workflow.sync(projectPath, abortController)
    );
  }

  stop(projectPath?: string) {
    this.jobs.stop(projectPath);
    return { success: true as const };
  }

  status(projectPath?: string) {
    return { success: true as const, ...this.jobs.status(projectPath) };
  }

  private start(
    projectPath: string,
    type: 'spec_regeneration' | 'feature_generation' | 'sync',
    operation: (abortController: AbortController) => Promise<void>
  ) {
    const controller = this.jobs.start(projectPath, type);
    if (!controller) {
      return { success: false as const, error: 'Operation already running for this project' };
    }
    void operation(controller)
      .catch((error) => {
        this.events.emit('spec-regeneration:event', {
          type: 'spec_regeneration_error',
          error: error instanceof Error ? error.message : String(error),
          projectPath,
        } as never);
      })
      .finally(() => this.jobs.finish(projectPath, controller));
    return { success: true as const };
  }
}
