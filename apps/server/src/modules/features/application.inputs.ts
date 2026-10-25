/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface FeatureConflictCheckInput {
  projectPath: string;
  data: string;
}

export interface FeatureExportInput {
  projectPath: string;
  format: 'json' | 'yaml';
  includeHistory: boolean;
  includePlanSpec: boolean;
  prettyPrint: boolean;
  featureIds?: string[] | undefined;
  category?: string | undefined;
  status?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface FeatureBulkDeleteInput {
  projectPath: string;
  featureIds: string[];
}

export interface FeatureBulkUpdateInput {
  projectPath: string;
  featureIds: string[];
  updates: { [x: string]: unknown };
}

export interface FeatureCreateInput {
  projectPath: string;
  feature: { [x: string]: unknown };
}

export interface FeatureImportInput {
  projectPath: string;
  data: string;
  overwrite: boolean;
  preserveBranchInfo: boolean;
  targetCategory?: string | undefined;
}

export interface FeatureUpdateInput {
  projectPath: string;
  featureId: string;
  updates: { [x: string]: unknown };
  descriptionHistorySource?: 'enhance' | 'edit' | undefined;
  enhancementMode?: 'improve' | 'technical' | 'simplify' | 'acceptance' | 'ux-reviewer' | undefined;
  preEnhancementDescription?: string | undefined;
}

export interface OrphanBulkResolveInput {
  projectPath: string;
  featureIds: string[];
  action: 'delete' | 'create-worktree' | 'move-to-branch';
  targetBranch?: string | null | undefined;
}

export interface OrphanResolveInput {
  projectPath: string;
  featureId: string;
  action: 'delete' | 'create-worktree' | 'move-to-branch';
  targetBranch?: string | null | undefined;
}
