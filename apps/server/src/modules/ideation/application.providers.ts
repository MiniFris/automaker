import type { FactoryProvider } from '@nestjs/common';
import { IdeationApplicationService } from './ideation-application.service.js';
import { IdeationService } from '../../services/ideation-service.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import { FEATURE_REPOSITORY } from '../features/feature.repository.js';
import { ProjectFeatureSerializer } from '../features/project-feature-serializer.js';
import { FeatureTransitionService } from '../features/feature-transition.service.js';
import { IdeaConversionStore } from './idea-conversion.store.js';

export const ideationApplicationServiceProvider: FactoryProvider<IdeationApplicationService> = {
  provide: IdeationApplicationService,
  inject: [
    IdeationService,
    APPLICATION_EVENTS,
    FEATURE_REPOSITORY,
    ProjectFeatureSerializer,
    FeatureTransitionService,
    IdeaConversionStore,
  ],
  useFactory: (
    ideation: ConstructorParameters<typeof IdeationApplicationService>[0],
    events: ConstructorParameters<typeof IdeationApplicationService>[1],
    features: ConstructorParameters<typeof IdeationApplicationService>[2],
    serializer: ConstructorParameters<typeof IdeationApplicationService>[3],
    transitions: ConstructorParameters<typeof IdeationApplicationService>[4],
    conversions: ConstructorParameters<typeof IdeationApplicationService>[5]
  ) =>
    new IdeationApplicationService(
      ideation,
      events,
      features,
      serializer,
      transitions,
      conversions
    ),
};
