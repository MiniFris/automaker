import {
  featureQueryServiceProvider,
  featureCommandServiceProvider,
} from './application.providers.js';
import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller.js';

import { FEATURE_REPOSITORY } from './feature.repository.js';
import { FileFeatureRepository } from './file-feature.repository.js';
import { FeatureStorageModule } from './feature-storage.module.js';

import { FeatureTransitionService } from './feature-transition.service.js';
import { ProjectFeatureSerializer } from './project-feature-serializer.js';
import { FeatureTitleService } from './feature-title.service.js';
import { ContextModule } from '../context/context.module.js';

@Module({
  imports: [ContextModule, FeatureStorageModule],
  controllers: [FeaturesController],
  providers: [
    featureQueryServiceProvider,
    featureCommandServiceProvider,
    FeatureTransitionService,
    ProjectFeatureSerializer,
    FeatureTitleService,
    FileFeatureRepository,
    { provide: FEATURE_REPOSITORY, useExisting: FileFeatureRepository },
  ],
  exports: [FEATURE_REPOSITORY, ProjectFeatureSerializer, FeatureTransitionService],
})
export class FeaturesModule {}
