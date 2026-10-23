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

  create(projectPath: string, feature: Parameters<FeatureLoader['create']>[1]) {
    return this.featureLoader.create(projectPath, feature);
  }

  update(
    projectPath: string,
    featureId: string,
    updates: Parameters<FeatureLoader['update']>[2],
    descriptionHistorySource?: Parameters<FeatureLoader['update']>[3],
    enhancementMode?: Parameters<FeatureLoader['update']>[4],
    preEnhancementDescription?: string
  ) {
    return this.featureLoader.update(
      projectPath,
      featureId,
      updates,
      descriptionHistorySource,
      enhancementMode,
      preEnhancementDescription
    );
  }

  delete(projectPath: string, featureId: string) {
    return this.featureLoader.delete(projectPath, featureId);
  }

  syncToAppSpec(
    projectPath: string,
    feature: Parameters<FeatureLoader['syncFeatureToAppSpec']>[1]
  ) {
    return this.featureLoader.syncFeatureToAppSpec(projectPath, feature);
  }
}
