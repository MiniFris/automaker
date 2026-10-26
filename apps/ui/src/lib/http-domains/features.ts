import { getUiLocale } from '../i18n';
import type { HttpDomainTransport } from './transport';
import type { FeaturesAPI } from '../electron';
import type { Feature } from '@automaker/types';

export function createFeaturesClient(
  transport: Pick<HttpDomainTransport, 'get' | 'post'>
): FeaturesAPI & {
  bulkUpdate: (
    projectPath: string,
    featureIds: string[],
    updates: Partial<Feature>
  ) => Promise<{
    success: boolean;
    updatedCount?: number;
    failedCount?: number;
    results?: Array<{ featureId: string; success: boolean; error?: string }>;
    features?: Feature[];
    error?: string;
  }>;
  bulkDelete: (
    projectPath: string,
    featureIds: string[]
  ) => Promise<{
    success: boolean;
    deletedCount?: number;
    failedCount?: number;
    results?: Array<{ featureId: string; success: boolean; error?: string }>;
    error?: string;
  }>;
  export: (
    projectPath: string,
    options?: {
      featureIds?: string[];
      format?: 'json' | 'yaml';
      includeHistory?: boolean;
      includePlanSpec?: boolean;
      category?: string;
      status?: string;
      prettyPrint?: boolean;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<{
    success: boolean;
    data?: string;
    format?: 'json' | 'yaml';
    contentType?: string;
    filename?: string;
    error?: string;
  }>;
  import: (
    projectPath: string,
    data: string,
    options?: {
      overwrite?: boolean;
      preserveBranchInfo?: boolean;
      targetCategory?: string;
    }
  ) => Promise<{
    success: boolean;
    importedCount?: number;
    failedCount?: number;
    results?: Array<{
      success: boolean;
      featureId?: string;
      importedAt: string;
      warnings?: string[];
      errors?: string[];
      wasOverwritten?: boolean;
    }>;
    error?: string;
  }>;
  checkConflicts: (
    projectPath: string,
    data: string
  ) => Promise<{
    success: boolean;
    hasConflicts?: boolean;
    conflicts?: Array<{
      featureId: string;
      title?: string;
      existingTitle?: string;
      hasConflict: boolean;
    }>;
    totalFeatures?: number;
    conflictCount?: number;
    error?: string;
  }>;
} {
  return {
    getAll: (projectPath: string) =>
      transport.get(`/api/features/list?projectPath=${encodeURIComponent(projectPath)}`),
    get: (projectPath: string, featureId: string) =>
      transport.post('/api/features/get', { projectPath, featureId }),
    create: (projectPath: string, feature: Feature) =>
      transport.post('/api/features/create', { projectPath, feature }),
    update: (
      projectPath: string,
      featureId: string,
      updates: Partial<Feature>,
      descriptionHistorySource?: 'enhance' | 'edit',
      enhancementMode?: 'improve' | 'technical' | 'simplify' | 'acceptance' | 'ux-reviewer',
      preEnhancementDescription?: string
    ) =>
      transport.post('/api/features/update', {
        projectPath,
        featureId,
        updates,
        descriptionHistorySource,
        enhancementMode,
        preEnhancementDescription,
      }),
    delete: (projectPath: string, featureId: string) =>
      transport.post('/api/features/delete', { projectPath, featureId }),
    getAgentOutput: (projectPath: string, featureId: string) =>
      transport.post('/api/features/agent-output', { projectPath, featureId }),
    generateTitle: (description: string, projectPath?: string) =>
      transport.post('/api/features/generate-title', {
        description,
        projectPath,
        outputLocale: getUiLocale(),
      }),
    bulkUpdate: (projectPath: string, featureIds: string[], updates: Partial<Feature>) =>
      transport.post('/api/features/bulk-update', { projectPath, featureIds, updates }),
    bulkDelete: (projectPath: string, featureIds: string[]) =>
      transport.post('/api/features/bulk-delete', { projectPath, featureIds }),
    export: (
      projectPath: string,
      options?: {
        featureIds?: string[];
        format?: 'json' | 'yaml';
        includeHistory?: boolean;
        includePlanSpec?: boolean;
        category?: string;
        status?: string;
        prettyPrint?: boolean;
        metadata?: Record<string, unknown>;
      }
    ): Promise<{
      success: boolean;
      data?: string;
      format?: 'json' | 'yaml';
      contentType?: string;
      filename?: string;
      error?: string;
    }> => transport.post('/api/features/export', { projectPath, ...options }),
    import: (
      projectPath: string,
      data: string,
      options?: {
        overwrite?: boolean;
        preserveBranchInfo?: boolean;
        targetCategory?: string;
      }
    ): Promise<{
      success: boolean;
      importedCount?: number;
      failedCount?: number;
      results?: Array<{
        success: boolean;
        featureId?: string;
        importedAt: string;
        warnings?: string[];
        errors?: string[];
        wasOverwritten?: boolean;
      }>;
      error?: string;
    }> => transport.post('/api/features/import', { projectPath, data, ...options }),
    checkConflicts: (
      projectPath: string,
      data: string
    ): Promise<{
      success: boolean;
      hasConflicts?: boolean;
      conflicts?: Array<{
        featureId: string;
        title?: string;
        existingTitle?: string;
        hasConflict: boolean;
      }>;
      totalFeatures?: number;
      conflictCount?: number;
      error?: string;
    }> => transport.post('/api/features/check-conflicts', { projectPath, data }),
    getOrphaned: (
      projectPath: string
    ): Promise<{
      success: boolean;
      orphanedFeatures?: Array<{ feature: Feature; missingBranch: string }>;
      error?: string;
    }> => transport.post('/api/features/orphaned', { projectPath }),
    resolveOrphaned: (
      projectPath: string,
      featureId: string,
      action: 'delete' | 'create-worktree' | 'move-to-branch',
      targetBranch?: string | null
    ): Promise<{
      success: boolean;
      action?: string;
      worktreePath?: string;
      branchName?: string;
      error?: string;
    }> =>
      transport.post('/api/features/orphaned/resolve', {
        projectPath,
        featureId,
        action,
        targetBranch,
      }),
    bulkResolveOrphaned: (
      projectPath: string,
      featureIds: string[],
      action: 'delete' | 'create-worktree' | 'move-to-branch',
      targetBranch?: string | null
    ): Promise<{
      success: boolean;
      resolvedCount?: number;
      failedCount?: number;
      results?: Array<{ featureId: string; success: boolean; action?: string; error?: string }>;
      error?: string;
    }> =>
      transport.post('/api/features/orphaned/bulk-resolve', {
        projectPath,
        featureIds,
        action,
        targetBranch,
      }),
  };
}
