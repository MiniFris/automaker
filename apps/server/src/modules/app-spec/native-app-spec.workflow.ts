import { Inject, Injectable } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { SettingsService } from '../../services/settings-service.js';
import { NotificationService } from '../../services/notification-service.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { PlanningWorkflowContext } from './planning-workflow.context.js';
import type { AppSpecGenerationOptions, AppSpecWorkflowPort } from './app-spec-workflow.port.js';
import { generateSpec } from './generate-spec.workflow.js';
import { generateFeaturesFromSpec } from './generate-features-from-spec.workflow.js';
import { syncSpec } from './sync-spec.workflow.js';

@Injectable()
export class NativeAppSpecWorkflow implements AppSpecWorkflowPort {
  constructor(
    @Inject(APPLICATION_EVENTS) private readonly events: EventEmitter,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry,
    @Inject(PlanningWorkflowContext) private readonly context: PlanningWorkflowContext
  ) {}
  generate(options: AppSpecGenerationOptions): Promise<void> {
    const run = this.context.operation(options.projectPath, options.abortController.signal);
    return generateSpec(
      run.projectPath,
      options.source,
      this.events,
      options.abortController,
      options.generateFeatures,
      options.analyzeProject,
      options.maxFeatures,
      this.settings,
      this.notifications,
      this.providers,
      run
    );
  }
  generateFeatures(
    project: string,
    max: number | undefined,
    controller: AbortController
  ): Promise<void> {
    const run = this.context.operation(project, controller.signal);
    return generateFeaturesFromSpec(
      run.projectPath,
      this.events,
      controller,
      max,
      this.settings,
      this.notifications,
      this.providers,
      run
    );
  }
  async sync(project: string, controller: AbortController): Promise<void> {
    const run = this.context.operation(project, controller.signal);
    await syncSpec(
      run.projectPath,
      this.events,
      controller,
      this.settings,
      this.notifications,
      this.providers,
      run
    );
  }
}
