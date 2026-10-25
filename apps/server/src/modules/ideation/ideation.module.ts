import { DirectCheckpointRepository } from '../providers/direct-checkpoint.repository.js';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
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
import { SECURE_FILESYSTEM } from '../../core/security/security.module.js';
import { IdeaConversionStore } from './idea-conversion.store.js';

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
        SECURE_FILESYSTEM,
        HOST_ENVIRONMENT,
        DirectCheckpointRepository,
      ],
      useFactory: (
        events: EventEmitter,
        settings: SettingsService,
        features: FeatureLoader,
        providers: ProviderRegistry,
        security: SecurityService,
        filesystem: ConstructorParameters<typeof IdeationService>[5],
        hostEnvironment: Readonly<NodeJS.ProcessEnv>,
        checkpointRepository: DirectCheckpointRepository
      ) =>
        new IdeationService(
          events,
          settings,
          features,
          providers,
          (cwd) => {
            security.validateLocalPath(cwd, 'ideation working directory');
          },
          filesystem,
          hostEnvironment,
          checkpointRepository
        ),
    },
    IdeationApplicationService,
    IdeaConversionStore,
  ],
  exports: [IdeationService],
})
export class IdeationModule {}
