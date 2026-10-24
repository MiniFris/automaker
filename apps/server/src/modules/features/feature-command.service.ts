import { Inject, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Feature, FeatureExport, FeatureImportResult } from '@automaker/types';
import { EVENT_BUS, type EventBus } from '../../core/eventing/index.js';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { execGitCommand } from '../../lib/git.js';
import { deleteWorktreeMetadata } from '../../lib/worktree-metadata.js';
import { FeatureExportService } from '../../services/feature-export-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { FEATURE_REPOSITORY, type FeatureRepository } from './feature.repository.js';
import type {
  FeatureBulkDeleteRequest,
  FeatureBulkUpdateRequest,
  FeatureCreateRequest,
  FeatureImportRequest,
  FeatureUpdateRequest,
  OrphanBulkResolveRequest,
  OrphanResolveRequest,
} from './feature.schemas.js';
import { FeatureTransitionService } from './feature-transition.service.js';
import { ProjectFeatureSerializer } from './project-feature-serializer.js';
import { SECURE_FILESYSTEM } from '../../core/security/index.js';
import type * as Filesystem from '../../lib/secure-fs.js';

export interface ResolveResult {
  featureId: string;
  success: boolean;
  action?: string;
  error?: string;
}

@Injectable()
export class FeatureCommandService {
  private readonly imports: FeatureExportService;

  constructor(
    @Inject(FEATURE_REPOSITORY) private readonly features: FeatureRepository,
    @Inject(FeatureLoader) featureLoader: FeatureLoader,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(FeatureTransitionService) private readonly transitions: FeatureTransitionService,
    @Inject(ProjectFeatureSerializer) private readonly serializer: ProjectFeatureSerializer,
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: Pick<typeof Filesystem, 'rm'>
  ) {
    this.imports = new FeatureExportService(featureLoader);
  }

  create(input: FeatureCreateRequest) {
    return this.serializer.run(input.projectPath, async () => {
      this.transitions.assertAllowed(input.feature.status);
      const created = await this.features.create(
        input.projectPath,
        input.feature as Partial<Feature>
      );
      this.events.emit('feature:created', {
        featureId: created.id,
        projectPath: input.projectPath,
        featureName: created.title || 'Untitled Feature',
      });
      return { success: true as const, feature: created };
    });
  }

  update(input: FeatureUpdateRequest) {
    return this.serializer.run(input.projectPath, async () => {
      this.transitions.assertAllowed(input.updates.status);
      const current = await this.features.get(input.projectPath, input.featureId);
      if (!current) throw new NotFoundDomainError(`Feature ${input.featureId} not found`);
      const updated = await this.features.update(
        input.projectPath,
        input.featureId,
        input.updates as Partial<Feature>,
        input.descriptionHistorySource,
        input.enhancementMode,
        input.preEnhancementDescription
      );
      if (this.transitions.isNewCompletion(current.status, input.updates.status)) {
        const status = input.updates.status;
        this.events.emit('feature:completed', {
          featureId: input.featureId,
          featureName: updated.title,
          projectPath: input.projectPath,
          passes: true,
          message:
            status === 'verified' ? 'Feature verified manually' : 'Feature completed manually',
          executionMode: 'manual',
        });
        await this.features.syncToAppSpec(input.projectPath, updated).catch(() => false);
      }
      return { success: true as const, feature: updated };
    });
  }

  remove(projectPath: string, featureId: string) {
    return this.serializer.run(projectPath, async () => ({
      success: await this.features.delete(projectPath, featureId),
    }));
  }

  bulkUpdate(input: FeatureBulkUpdateRequest) {
    return this.serializer.run(input.projectPath, async () => {
      this.transitions.assertAllowed(input.updates.status);
      const results: Array<{ featureId: string; success: boolean; error?: string }> = [];
      const features: Feature[] = [];
      for (const featureId of input.featureIds) {
        try {
          const feature = await this.features.update(
            input.projectPath,
            featureId,
            input.updates as Partial<Feature>
          );
          features.push(feature);
          results.push({ featureId, success: true });
        } catch (error) {
          results.push({
            featureId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const updatedCount = results.filter(({ success }) => success).length;
      return {
        success: updatedCount === results.length,
        updatedCount,
        failedCount: results.length - updatedCount,
        results,
        features,
      };
    });
  }

  bulkDelete(input: FeatureBulkDeleteRequest) {
    return this.serializer.run(input.projectPath, async () => {
      const results: ResolveResult[] = [];
      for (const featureId of input.featureIds) {
        const success = await this.features.delete(input.projectPath, featureId);
        results.push({
          featureId,
          success,
          ...(!success && { error: 'Deletion failed. Check server logs for details.' }),
        });
      }
      const deletedCount = results.filter(({ success }) => success).length;
      return {
        success: deletedCount === results.length,
        deletedCount,
        failedCount: results.length - deletedCount,
        results,
      };
    });
  }

  import(input: FeatureImportRequest) {
    return this.serializer.run(input.projectPath, async () => {
      if (!this.imports.detectFormat(input.data)) {
        throw new ValidationDomainError('Invalid data format. Expected valid JSON or YAML.');
      }
      const parsed = this.imports.parseImportData(input.data);
      if (!parsed) {
        throw new ValidationDomainError(
          'Failed to parse import data. Ensure it is valid JSON or YAML.'
        );
      }
      let results: FeatureImportResult[];
      if (this.imports.isBulkExport(parsed)) {
        results = await this.imports.importFeatures(input.projectPath, parsed, input);
      } else {
        results = [
          await this.imports.importFeature(input.projectPath, {
            data: parsed as Feature | FeatureExport,
            overwrite: input.overwrite,
            preserveBranchInfo: input.preserveBranchInfo,
            targetCategory: input.targetCategory,
          }),
        ];
      }
      const importedCount = results.filter(({ success }) => success).length;
      return {
        success: importedCount === results.length,
        importedCount,
        failedCount: results.length - importedCount,
        results,
      };
    });
  }

  resolveOrphan(input: OrphanResolveRequest) {
    return this.serializer.run(input.projectPath, () => this.resolveOrphanUnsafe(input));
  }

  bulkResolveOrphans(input: OrphanBulkResolveRequest) {
    return this.serializer.run(input.projectPath, async () => {
      const results: ResolveResult[] = [];
      for (const featureId of input.featureIds) {
        results.push(await this.resolveOrphanUnsafe({ ...input, featureId }));
      }
      const resolvedCount = results.filter(({ success }) => success).length;
      return {
        success: resolvedCount === results.length,
        resolvedCount,
        failedCount: results.length - resolvedCount,
        results,
      };
    });
  }

  private async resolveOrphanUnsafe(input: OrphanResolveRequest): Promise<ResolveResult> {
    const feature = await this.features.get(input.projectPath, input.featureId);
    if (!feature) throw new NotFoundDomainError('Feature not found');
    const missingBranch = feature.branchName;
    try {
      if (input.action === 'delete') {
        if (missingBranch)
          await deleteWorktreeMetadata(input.projectPath, missingBranch, this.filesystem);
        const success = await this.features.delete(input.projectPath, input.featureId);
        return { featureId: input.featureId, success, action: success ? 'deleted' : undefined };
      }
      if (input.action === 'create-worktree') {
        if (!missingBranch) {
          return {
            featureId: input.featureId,
            success: false,
            error: 'Feature has no branch name to recreate',
          };
        }
        const sanitizedName = missingBranch.replace(/[^a-zA-Z0-9_-]/g, '-');
        const hash = crypto.createHash('sha1').update(missingBranch).digest('hex').slice(0, 8);
        const worktreePath = path.join(input.projectPath, '.worktrees', `${sanitizedName}-${hash}`);
        try {
          await execGitCommand(
            ['worktree', 'add', '-b', missingBranch, worktreePath],
            input.projectPath
          );
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('already exists')) throw error;
          await execGitCommand(['worktree', 'add', worktreePath, missingBranch], input.projectPath);
        }
        return { featureId: input.featureId, success: true, action: 'worktree-created' };
      }

      const targetBranch = input.targetBranch || null;
      if (targetBranch) {
        await execGitCommand(['rev-parse', '--verify', targetBranch], input.projectPath);
      }
      if (missingBranch)
        await deleteWorktreeMetadata(input.projectPath, missingBranch, this.filesystem);
      await this.features.update(input.projectPath, input.featureId, {
        branchName: targetBranch,
        status: 'pending',
      });
      return { featureId: input.featureId, success: true, action: 'moved' };
    } catch (error) {
      return {
        featureId: input.featureId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
