import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller.js';
import { FeatureQueryService } from './feature-query.service.js';
import { FEATURE_REPOSITORY } from './feature.repository.js';
import { LegacyFeatureRepository } from './legacy-feature.repository.js';
import { FeatureCommandService } from './feature-command.service.js';
import { FeatureTransitionService } from './feature-transition.service.js';
import { ProjectFeatureSerializer } from './project-feature-serializer.js';
import { FeatureTitleService } from './feature-title.service.js';
import { ContextModule } from '../context/context.module.js';

@Module({
  imports: [ContextModule],
  controllers: [FeaturesController],
  providers: [
    FeatureQueryService,
    FeatureCommandService,
    FeatureTransitionService,
    ProjectFeatureSerializer,
    FeatureTitleService,
    LegacyFeatureRepository,
    { provide: FEATURE_REPOSITORY, useExisting: LegacyFeatureRepository },
  ],
  exports: [FEATURE_REPOSITORY, ProjectFeatureSerializer, FeatureTransitionService],
})
export class FeaturesModule {}
