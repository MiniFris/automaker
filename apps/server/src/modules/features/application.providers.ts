import type { FactoryProvider } from '@nestjs/common';
import { FeatureQueryService } from './feature-query.service.js';
import { FeatureCommandService } from './feature-command.service.js';
import { FEATURE_REPOSITORY } from './feature.repository.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { FEATURE_ORPHAN_QUERY } from '../auto-mode/auto-mode.ports.js';
import { EVENT_BUS } from '../../core/eventing/index.js';
import { FeatureTransitionService } from './feature-transition.service.js';
import { ProjectFeatureSerializer } from './project-feature-serializer.js';
import { SECURE_FILESYSTEM } from '../../core/security/index.js';

export const featureQueryServiceProvider: FactoryProvider<FeatureQueryService> = {
  provide: FeatureQueryService,
  inject: [FEATURE_REPOSITORY, FeatureLoader, FEATURE_ORPHAN_QUERY],
  useFactory: (
    features: ConstructorParameters<typeof FeatureQueryService>[0],
    featureLoader: ConstructorParameters<typeof FeatureQueryService>[1],
    autoMode: ConstructorParameters<typeof FeatureQueryService>[2]
  ) => new FeatureQueryService(features, featureLoader, autoMode),
};

export const featureCommandServiceProvider: FactoryProvider<FeatureCommandService> = {
  provide: FeatureCommandService,
  inject: [
    FEATURE_REPOSITORY,
    FeatureLoader,
    EVENT_BUS,
    FeatureTransitionService,
    ProjectFeatureSerializer,
    SECURE_FILESYSTEM,
  ],
  useFactory: (
    features: ConstructorParameters<typeof FeatureCommandService>[0],
    featureLoader: ConstructorParameters<typeof FeatureCommandService>[1],
    events: ConstructorParameters<typeof FeatureCommandService>[2],
    transitions: ConstructorParameters<typeof FeatureCommandService>[3],
    serializer: ConstructorParameters<typeof FeatureCommandService>[4],
    filesystem: ConstructorParameters<typeof FeatureCommandService>[5]
  ) =>
    new FeatureCommandService(features, featureLoader, events, transitions, serializer, filesystem),
};
