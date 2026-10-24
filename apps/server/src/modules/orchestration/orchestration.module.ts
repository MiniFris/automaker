import { Global, Module } from '@nestjs/common';
import { FeatureRunCoordinator } from './feature-run-coordinator.service.js';
import { BackgroundIntegrationsLifecycle } from './background-integrations.lifecycle.js';
import { EventHookService } from '../../services/event-hook-service.js';

@Global()
@Module({
  providers: [
    FeatureRunCoordinator,
    { provide: EventHookService, useFactory: () => new EventHookService() },
    BackgroundIntegrationsLifecycle,
  ],
  exports: [FeatureRunCoordinator],
})
export class OrchestrationModule {}
