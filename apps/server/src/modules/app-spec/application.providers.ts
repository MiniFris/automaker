import type { FactoryProvider } from '@nestjs/common';
import { AppSpecApplicationService } from './app-spec-application.service.js';
import { APP_SPEC_WORKFLOW_PORT } from './app-spec-workflow.port.js';
import { AppSpecJobRegistry } from './app-spec-job.registry.js';
import { EVENT_BUS } from '../../core/eventing/index.js';

export const appSpecApplicationServiceProvider: FactoryProvider<AppSpecApplicationService> = {
  provide: AppSpecApplicationService,
  inject: [APP_SPEC_WORKFLOW_PORT, AppSpecJobRegistry, EVENT_BUS],
  useFactory: (
    workflow: ConstructorParameters<typeof AppSpecApplicationService>[0],
    jobs: ConstructorParameters<typeof AppSpecApplicationService>[1],
    events: ConstructorParameters<typeof AppSpecApplicationService>[2]
  ) => new AppSpecApplicationService(workflow, jobs, events),
};
