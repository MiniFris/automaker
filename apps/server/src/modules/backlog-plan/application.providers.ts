import type { FactoryProvider } from '@nestjs/common';
import { BacklogPlanApplicationService } from './backlog-plan-application.service.js';
import { BACKLOG_PLAN_WORKFLOW, BACKLOG_PLAN_STORE } from './backlog-plan.ports.js';
import { BacklogPlanJobRegistry } from './backlog-plan-job.registry.js';
import { FEATURE_REPOSITORY } from '../features/feature.repository.js';
import { ProjectFeatureSerializer } from '../features/project-feature-serializer.js';
import { FeatureTransitionService } from '../features/feature-transition.service.js';
import { SettingsService } from '../../services/settings-service.js';

export const backlogPlanApplicationServiceProvider: FactoryProvider<BacklogPlanApplicationService> =
  {
    provide: BacklogPlanApplicationService,
    inject: [
      BACKLOG_PLAN_WORKFLOW,
      BACKLOG_PLAN_STORE,
      BacklogPlanJobRegistry,
      FEATURE_REPOSITORY,
      ProjectFeatureSerializer,
      FeatureTransitionService,
      SettingsService,
    ],
    useFactory: (
      workflow: ConstructorParameters<typeof BacklogPlanApplicationService>[0],
      store: ConstructorParameters<typeof BacklogPlanApplicationService>[1],
      jobs: ConstructorParameters<typeof BacklogPlanApplicationService>[2],
      features: ConstructorParameters<typeof BacklogPlanApplicationService>[3],
      serializer: ConstructorParameters<typeof BacklogPlanApplicationService>[4],
      transitions: ConstructorParameters<typeof BacklogPlanApplicationService>[5],
      settings: ConstructorParameters<typeof BacklogPlanApplicationService>[6]
    ) =>
      new BacklogPlanApplicationService(
        workflow,
        store,
        jobs,
        features,
        serializer,
        transitions,
        settings
      ),
  };
