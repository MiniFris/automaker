import { Global, Module } from '@nestjs/common';
import { FeatureRunCoordinator } from './feature-run-coordinator.service.js';
import { BackgroundIntegrationsLifecycle } from './background-integrations.lifecycle.js';
import { EventHookService } from '../../services/event-hook-service.js';
import { NtfyService } from '../../services/ntfy-service.js';
import { HOST_ENVIRONMENT, WORKING_DIRECTORY } from '../../core/config/index.js';

@Global()
@Module({
  providers: [
    FeatureRunCoordinator,
    { provide: NtfyService, useFactory: () => new NtfyService() },
    {
      provide: EventHookService,
      inject: [NtfyService, HOST_ENVIRONMENT, WORKING_DIRECTORY],
      useFactory: (
        ntfy: NtfyService,
        environment: Readonly<NodeJS.ProcessEnv>,
        workingDirectory: string
      ) => new EventHookService(ntfy, environment, workingDirectory),
    },
    BackgroundIntegrationsLifecycle,
  ],
  exports: [FeatureRunCoordinator],
})
export class OrchestrationModule {}
