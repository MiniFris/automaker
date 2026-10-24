import { Inject, Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import { EVENT_BUS, type EventBus } from '../../core/eventing/event-bus.js';
import { cleanupStaleValidations } from '../../routes/github/routes/validation-common.js';
import { EventHistoryService } from '../../services/event-history-service.js';
import { EventHookService } from '../../services/event-hook-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { SettingsService } from '../../services/settings-service.js';

const logger = createLogger('BackgroundIntegrations');
const VALIDATION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class BackgroundIntegrationsLifecycle implements OnModuleInit, OnModuleDestroy {
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EventHistoryService) private readonly history: EventHistoryService,
    @Inject(FeatureLoader) private readonly features: FeatureLoader,
    @Inject(EventHookService) private readonly hooks: EventHookService
  ) {}

  onModuleInit(): void {
    this.hooks.initialize(this.events, this.settings, this.history, this.features);
    this.cleanupInterval = setInterval(() => {
      const cleaned = cleanupStaleValidations();
      if (cleaned > 0) logger.info(`Cleaned up ${cleaned} stale validation entries`);
    }, VALIDATION_CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;
    await this.hooks.destroy();
  }
}
