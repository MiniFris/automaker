import { Module } from '@nestjs/common';
import { AppSpecApplicationService } from './app-spec-application.service.js';
import { AppSpecController } from './app-spec.controller.js';
import { AppSpecJobRegistry } from './app-spec-job.registry.js';
import { APP_SPEC_WORKFLOW_PORT } from './app-spec-workflow.port.js';
import { LegacyAppSpecWorkflowAdapter } from './legacy-app-spec-workflow.adapter.js';

@Module({
  controllers: [AppSpecController],
  providers: [
    AppSpecApplicationService,
    AppSpecJobRegistry,
    LegacyAppSpecWorkflowAdapter,
    { provide: APP_SPEC_WORKFLOW_PORT, useExisting: LegacyAppSpecWorkflowAdapter },
  ],
})
export class AppSpecModule {}
