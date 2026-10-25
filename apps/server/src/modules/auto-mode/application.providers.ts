import type { FactoryProvider } from '@nestjs/common';
import { AutoModeApplicationService } from './auto-mode-application.service.js';
import { AUTO_MODE_SCHEDULER, FEATURE_WORKFLOW, AUTO_MODE_LIFECYCLE } from './auto-mode.ports.js';
import { ProjectRunContextRegistry } from './project-run-context.registry.js';
import { ProjectAnalysisService } from './project-analysis.service.js';

export const autoModeApplicationServiceProvider: FactoryProvider<AutoModeApplicationService> = {
  provide: AutoModeApplicationService,
  inject: [
    AUTO_MODE_SCHEDULER,
    FEATURE_WORKFLOW,
    AUTO_MODE_LIFECYCLE,
    ProjectRunContextRegistry,
    ProjectAnalysisService,
  ],
  useFactory: (
    scheduler: ConstructorParameters<typeof AutoModeApplicationService>[0],
    workflows: ConstructorParameters<typeof AutoModeApplicationService>[1],
    recovery: ConstructorParameters<typeof AutoModeApplicationService>[2],
    contexts: ConstructorParameters<typeof AutoModeApplicationService>[3],
    analysis: ConstructorParameters<typeof AutoModeApplicationService>[4]
  ) => new AutoModeApplicationService(scheduler, workflows, recovery, contexts, analysis),
};
