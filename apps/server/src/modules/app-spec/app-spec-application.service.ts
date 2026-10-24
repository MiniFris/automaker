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

  create(source: AppSpecCreateRequest) {
    const input = { ...source };
    return this.start(input.projectPath, 'spec_regeneration', (abortController, projectPath) =>
      this.workflow.generate({
        projectPath,
        source: input.projectOverview,
        generateFeatures: input.generateFeatures,
        analyzeProject: input.analyzeProject,
        maxFeatures: input.maxFeatures,
        abortController,
      })
    );
  }

  generate(source: AppSpecGenerateRequest) {
    const input = { ...source };
    return this.start(input.projectPath, 'spec_regeneration', (abortController, projectPath) =>
      this.workflow.generate({
        projectPath,
        source: input.projectDefinition,
        generateFeatures: input.generateFeatures,
        analyzeProject: input.analyzeProject,
        maxFeatures: input.maxFeatures,
        abortController,
      })
    );
  }

  generateFeatures(source: AppSpecFeaturesRequest) {
    const input = { ...source };
    return this.start(input.projectPath, 'feature_generation', (abortController, projectPath) =>
      this.workflow.generateFeatures(projectPath, input.maxFeatures, abortController)
    );
  }

  sync(projectPath: string) {
    return this.start(projectPath, 'sync', (abortController, ownedProject) =>
      this.workflow.sync(ownedProject, abortController)
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
    operation: (abortController: AbortController, projectPath: string) => Promise<void>
  ) {
    const admitted = this.jobs.run(projectPath, type, (controller, ownedProject) =>
      operation(controller, ownedProject).catch(() => {
        this.events.emit('spec-regeneration:event', {
          type: 'spec_regeneration_error',
          error: 'Specification generation failed.',
          projectPath: ownedProject,
        } as never);
      })
    );
    if (!admitted) {
      return { success: false as const, error: 'Operation already running for this project' };
    }
    return { success: true as const };
  }
}
