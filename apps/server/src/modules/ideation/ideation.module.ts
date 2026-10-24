import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module.js';
import { IdeationApplicationService } from './ideation-application.service.js';
import { IdeationController } from './ideation.controller.js';
import { IdeationService } from '../../services/ideation-service.js';
import { SettingsService } from '../../services/settings-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';

@Module({
  imports: [FeaturesModule],
  controllers: [IdeationController],
  providers: [
    {
      provide: IdeationService,
      inject: [APPLICATION_EVENTS, SettingsService, FeatureLoader, ProviderRegistry],
      useFactory: (
        events: EventEmitter,
        settings: SettingsService,
        features: FeatureLoader,
        providers: ProviderRegistry
      ) => new IdeationService(events, settings, features, providers),
    },
    IdeationApplicationService,
  ],
  exports: [IdeationService],
})
export class IdeationModule {}
