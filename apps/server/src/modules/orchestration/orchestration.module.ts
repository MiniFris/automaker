import { Global, Module } from '@nestjs/common';
import { FeatureRunCoordinator } from './feature-run-coordinator.service.js';
import { BackgroundIntegrationsLifecycle } from './background-integrations.lifecycle.js';

@Global()
@Module({
  providers: [FeatureRunCoordinator, BackgroundIntegrationsLifecycle],
  exports: [FeatureRunCoordinator],
})
export class OrchestrationModule {}
