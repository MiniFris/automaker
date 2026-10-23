import { Global, Module } from '@nestjs/common';
import { FeatureRunCoordinator } from './feature-run-coordinator.service.js';

@Global()
@Module({
  providers: [FeatureRunCoordinator],
  exports: [FeatureRunCoordinator],
})
export class OrchestrationModule {}
