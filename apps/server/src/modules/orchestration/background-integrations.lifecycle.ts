import { Inject, Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { EVENT_BUS, type EventBus } from '../../core/eventing/event-bus.js';
import { EventHistoryService } from '../../services/event-history-service.js';
import { EventHookService } from '../../services/event-hook-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { SettingsService } from '../../services/settings-service.js';

@Injectable()
export class BackgroundIntegrationsLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EventHistoryService) private readonly history: EventHistoryService,
    @Inject(FeatureLoader) private readonly features: FeatureLoader,
    @Inject(EventHookService) private readonly hooks: EventHookService
  ) {}

  onModuleInit(): void {
    this.hooks.initialize(this.events, this.settings, this.history, this.features);
  }

  async onModuleDestroy(): Promise<void> {
    await this.hooks.destroy();
  }
}
