import type { FeatureConflictCheckInput, FeatureExportInput } from './application.inputs.js';

import { type FeatureOrphanQuery } from '../auto-mode/auto-mode.ports.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import {
  FeatureExportService,
  type BulkExportOptions,
} from '../../services/feature-export-service.js';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/domain-errors.js';
import { type FeatureRepository } from './feature.repository.js';

export class FeatureQueryService {
  private readonly exports: FeatureExportService;

  constructor(
    private readonly features: FeatureRepository,
    featureLoader: FeatureLoader,
    private readonly autoMode: FeatureOrphanQuery
  ) {
    this.exports = new FeatureExportService(featureLoader);
  }

  async list(projectPath: string) {
    const features = await this.features.list(projectPath);
    void this.autoMode.detectOrphanedFeatures(projectPath, features).catch(() => {});
    return { success: true as const, features };
  }

  async get(projectPath: string, featureId: string) {
    const feature = await this.features.get(projectPath, featureId);
    if (!feature) throw new NotFoundDomainError('Feature not found');
    return { success: true as const, feature };
  }

  async agentOutput(projectPath: string, featureId: string) {
    const [content, conversation] = await Promise.all([
      this.features.getAgentOutput(projectPath, featureId),
      this.features.getAgentConversation(projectPath, featureId),
    ]);
    return {
      success: true as const,
      content,
      conversation,
    };
  }

  async rawOutput(projectPath: string, featureId: string) {
    return {
      success: true as const,
      content: await this.features.getRawOutput(projectPath, featureId),
    };
  }

  async export(input: FeatureExportInput) {
    const { projectPath, format, ...options } = input;
    const data = await this.exports.exportFeatures(projectPath, {
      ...options,
      format,
    } as BulkExportOptions);
    return {
      success: true as const,
      data,
      format,
      contentType: format === 'json' ? 'application/json' : 'application/x-yaml',
      filename: `features-export.${format}`,
    };
  }

  async conflicts(input: FeatureConflictCheckInput) {
    const format = this.exports.detectFormat(input.data);
    if (!format) {
      throw new ValidationDomainError('Invalid data format. Expected valid JSON or YAML.');
    }
    const parsed = this.exports.parseImportData(input.data);
    if (!parsed) throw new ValidationDomainError('Failed to parse import data.');

    let candidates: Array<{ id: string; title?: string }> = [];
    if (this.exports.isBulkExport(parsed)) {
      candidates = parsed.features.map(({ feature }) => ({
        id: feature.id,
        title: feature.title,
      }));
    } else if (this.exports.isFeatureExport(parsed)) {
      candidates = [{ id: parsed.feature.id, title: parsed.feature.title }];
    } else if (this.exports.isRawFeature(parsed)) {
      candidates = [{ id: parsed.id, title: parsed.title }];
    }

    const conflicts = await Promise.all(
      candidates.map(async (candidate) => {
        const existing = await this.features.get(input.projectPath, candidate.id);
        return {
          featureId: candidate.id,
          title: candidate.title,
          existingTitle: existing?.title,
          hasConflict: !!existing,
        };
      })
    );
    const conflictCount = conflicts.filter(({ hasConflict }) => hasConflict).length;
    return {
      success: true as const,
      hasConflicts: conflictCount > 0,
      conflicts,
      totalFeatures: candidates.length,
      conflictCount,
    };
  }

  async orphaned(projectPath: string) {
    return {
      success: true as const,
      orphanedFeatures: await this.autoMode.detectOrphanedFeatures(projectPath),
    };
  }
}
