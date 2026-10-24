import { Module } from '@nestjs/common';
import { AppSpecApplicationService } from './app-spec-application.service.js';
import { AppSpecController } from './app-spec.controller.js';
import { AppSpecJobRegistry } from './app-spec-job.registry.js';
import { APP_SPEC_WORKFLOW_PORT } from './app-spec-workflow.port.js';
import { NativeAppSpecWorkflow } from './native-app-spec.workflow.js';
import { PlanningWorkflowContext } from './planning-workflow.context.js';

@Module({
  controllers: [AppSpecController],
  providers: [
    AppSpecApplicationService,
    AppSpecJobRegistry,
    PlanningWorkflowContext,
    NativeAppSpecWorkflow,
    { provide: APP_SPEC_WORKFLOW_PORT, useExisting: NativeAppSpecWorkflow },
  ],
  exports: [AppSpecJobRegistry, PlanningWorkflowContext],
})
export class AppSpecModule {}
