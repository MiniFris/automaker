import { Inject, Injectable } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { generateFeaturesFromSpec } from '../../routes/app-spec/generate-features-from-spec.js';
import { generateSpec } from '../../routes/app-spec/generate-spec.js';
import { syncSpec } from '../../routes/app-spec/sync-spec.js';
import { NotificationService } from '../../services/notification-service.js';
import { SettingsService } from '../../services/settings-service.js';
import type { AppSpecGenerationOptions, AppSpecWorkflowPort } from './app-spec-workflow.port.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';

@Injectable()
export class LegacyAppSpecWorkflowAdapter implements AppSpecWorkflowPort {
  constructor(
    @Inject(APPLICATION_EVENTS) private readonly events: EventEmitter,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry
  ) {}

  generate(options: AppSpecGenerationOptions): Promise<void> {
    return generateSpec(
      options.projectPath,
      options.source,
      this.events,
      options.abortController,
      options.generateFeatures,
      options.analyzeProject,
      options.maxFeatures,
      this.settings,
      this.notifications,
      this.providers
    );
  }

  generateFeatures(
    projectPath: string,
    maxFeatures: number | undefined,
    abortController: AbortController
  ): Promise<void> {
    return generateFeaturesFromSpec(
      projectPath,
      this.events,
      abortController,
      maxFeatures,
      this.settings,
      this.notifications,
      this.providers
    );
  }

  async sync(projectPath: string, abortController: AbortController): Promise<void> {
    await syncSpec(
      projectPath,
      this.events,
      abortController,
      this.settings,
      this.notifications,
      this.providers
    );
  }
}
