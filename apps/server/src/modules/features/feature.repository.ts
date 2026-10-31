import type { Feature, AgentConversationEntry } from '@automaker/types';

export const FEATURE_REPOSITORY = Symbol('FEATURE_REPOSITORY');

export interface FeatureRepository {
  list(projectPath: string): Promise<Feature[]>;
  get(projectPath: string, featureId: string): Promise<Feature | null>;
  getAgentOutput(projectPath: string, featureId: string): Promise<string | null>;
  getAgentConversation(projectPath: string, featureId: string): Promise<AgentConversationEntry[]>;
  getRawOutput(projectPath: string, featureId: string): Promise<string | null>;
  create(projectPath: string, feature: Partial<Feature>): Promise<Feature>;
  update(
    projectPath: string,
    featureId: string,
    updates: Partial<Feature>,
    descriptionHistorySource?: 'enhance' | 'edit',
    enhancementMode?: 'improve' | 'technical' | 'simplify' | 'acceptance' | 'ux-reviewer',
    preEnhancementDescription?: string
  ): Promise<Feature>;
  delete(projectPath: string, featureId: string): Promise<boolean>;
  syncToAppSpec(projectPath: string, feature: Feature): Promise<boolean>;
}
