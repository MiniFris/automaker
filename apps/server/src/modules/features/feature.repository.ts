import type { Feature } from '@automaker/types';

export const FEATURE_REPOSITORY = Symbol('FEATURE_REPOSITORY');

export interface FeatureRepository {
  list(projectPath: string): Promise<Feature[]>;
  get(projectPath: string, featureId: string): Promise<Feature | null>;
  getAgentOutput(projectPath: string, featureId: string): Promise<string | null>;
  getRawOutput(projectPath: string, featureId: string): Promise<string | null>;
}
