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
import { SecurityService } from '../../core/security/security.service.js';

@Module({
  imports: [FeaturesModule],
  controllers: [IdeationController],
  providers: [
    {
      provide: IdeationService,
      inject: [
        APPLICATION_EVENTS,
        SettingsService,
        FeatureLoader,
        ProviderRegistry,
        SecurityService,
      ],
      useFactory: (
        events: EventEmitter,
        settings: SettingsService,
        features: FeatureLoader,
        providers: ProviderRegistry,
        security: SecurityService
      ) =>
        new IdeationService(events, settings, features, providers, (cwd) => {
          security.validateLocalPath(cwd, 'ideation working directory');
        }),
    },
    IdeationApplicationService,
  ],
  exports: [IdeationService],
})
export class IdeationModule {}
