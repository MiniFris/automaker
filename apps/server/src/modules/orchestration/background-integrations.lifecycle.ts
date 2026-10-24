import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { cleanupStaleValidations } from '../../routes/github/routes/validation-common.js';
import { EventHistoryService } from '../../services/event-history-service.js';
import { EventHookService } from '../../services/event-hook-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { SettingsService } from '../../services/settings-service.js';

const logger = createLogger('BackgroundIntegrations');
const VALIDATION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class BackgroundIntegrationsLifecycle
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @Inject(APPLICATION_EVENTS) private readonly events: EventEmitter,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EventHistoryService) private readonly history: EventHistoryService,
    @Inject(FeatureLoader) private readonly features: FeatureLoader,
    @Inject(LEGACY_SERVICES.eventHook) private readonly hooks: EventHookService
  ) {}

  onApplicationBootstrap(): void {
    this.hooks.initialize(this.events, this.settings, this.history, this.features);
    this.cleanupInterval = setInterval(() => {
      const cleaned = cleanupStaleValidations();
      if (cleaned > 0) logger.info(`Cleaned up ${cleaned} stale validation entries`);
    }, VALIDATION_CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  onApplicationShutdown(): void {
    this.hooks.destroy();
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;
  }
}
