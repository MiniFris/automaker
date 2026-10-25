import { backlogPlanApplicationServiceProvider } from './application.providers.js';
import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module.js';

import { BacklogPlanJobRegistry } from './backlog-plan-job.registry.js';
import { BacklogPlanController } from './backlog-plan.controller.js';
import { BACKLOG_PLAN_STORE, BACKLOG_PLAN_WORKFLOW } from './backlog-plan.ports.js';
import { NativeBacklogPlanWorkflow } from './native-backlog-plan.workflow.js';
import { AppSpecModule } from '../app-spec/app-spec.module.js';
import { PlanningWorkflowContext } from '../app-spec/planning-workflow.context.js';

@Module({
  imports: [FeaturesModule, AppSpecModule],
  controllers: [BacklogPlanController],
  providers: [
    backlogPlanApplicationServiceProvider,
    BacklogPlanJobRegistry,
    NativeBacklogPlanWorkflow,
    { provide: BACKLOG_PLAN_WORKFLOW, useExisting: NativeBacklogPlanWorkflow },
    { provide: BACKLOG_PLAN_STORE, useExisting: PlanningWorkflowContext },
  ],
  exports: [BacklogPlanJobRegistry],
})
export class BacklogPlanModule {}
