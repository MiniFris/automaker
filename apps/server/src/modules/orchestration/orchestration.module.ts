import { Global, Module } from '@nestjs/common';
import { FeatureRunCoordinator } from './feature-run-coordinator.service.js';
import { BackgroundIntegrationsLifecycle } from './background-integrations.lifecycle.js';
import { EventHookService } from '../../services/event-hook-service.js';
import { NtfyService } from '../../services/ntfy-service.js';

@Global()
@Module({
  providers: [
    FeatureRunCoordinator,
    { provide: NtfyService, useFactory: () => new NtfyService() },
    {
      provide: EventHookService,
      inject: [NtfyService],
      useFactory: (ntfy: NtfyService) => new EventHookService(ntfy),
    },
    BackgroundIntegrationsLifecycle,
  ],
  exports: [FeatureRunCoordinator],
})
export class OrchestrationModule {}
