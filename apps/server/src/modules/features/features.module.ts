import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller.js';
import { FeatureQueryService } from './feature-query.service.js';
import { FEATURE_REPOSITORY } from './feature.repository.js';
import { LegacyFeatureRepository } from './legacy-feature.repository.js';

@Module({
  controllers: [FeaturesController],
  providers: [
    FeatureQueryService,
    LegacyFeatureRepository,
    { provide: FEATURE_REPOSITORY, useExisting: LegacyFeatureRepository },
  ],
  exports: [FEATURE_REPOSITORY],
})
export class FeaturesModule {}
