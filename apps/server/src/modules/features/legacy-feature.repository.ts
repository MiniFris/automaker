import { Inject, Injectable } from '@nestjs/common';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import type { FeatureRepository } from './feature.repository.js';

@Injectable()
export class LegacyFeatureRepository implements FeatureRepository {
  constructor(
    @Inject(LEGACY_SERVICES.featureLoader) private readonly featureLoader: FeatureLoader
  ) {}

  list(projectPath: string) {
    return this.featureLoader.getAll(projectPath);
  }

  get(projectPath: string, featureId: string) {
    return this.featureLoader.get(projectPath, featureId);
  }

  getAgentOutput(projectPath: string, featureId: string) {
    return this.featureLoader.getAgentOutput(projectPath, featureId);
  }

  getRawOutput(projectPath: string, featureId: string) {
    return this.featureLoader.getRawOutput(projectPath, featureId);
  }
}
