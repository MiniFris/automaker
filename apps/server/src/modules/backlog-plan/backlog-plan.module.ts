import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module.js';
import { BacklogPlanApplicationService } from './backlog-plan-application.service.js';
import { BacklogPlanJobRegistry } from './backlog-plan-job.registry.js';
import { BacklogPlanController } from './backlog-plan.controller.js';
import { BACKLOG_PLAN_STORE, BACKLOG_PLAN_WORKFLOW } from './backlog-plan.ports.js';
import { LegacyBacklogPlanAdapter } from './legacy-backlog-plan.adapter.js';

@Module({
  imports: [FeaturesModule],
  controllers: [BacklogPlanController],
  providers: [
    BacklogPlanApplicationService,
    BacklogPlanJobRegistry,
    LegacyBacklogPlanAdapter,
    { provide: BACKLOG_PLAN_WORKFLOW, useExisting: LegacyBacklogPlanAdapter },
    { provide: BACKLOG_PLAN_STORE, useExisting: LegacyBacklogPlanAdapter },
  ],
})
export class BacklogPlanModule {}
