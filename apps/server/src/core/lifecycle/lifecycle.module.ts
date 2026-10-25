import { Global, Module } from '@nestjs/common';
import { ReadinessStateService } from './readiness-state.service.js';
import { SupervisorCoordinator } from './supervisor-coordinator.service.js';

@Global()
@Module({
  providers: [ReadinessStateService, SupervisorCoordinator],
  exports: [ReadinessStateService, SupervisorCoordinator],
})
export class LifecycleModule {}
