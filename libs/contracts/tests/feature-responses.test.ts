import { expect, it } from 'vitest';
import {
  PublicFeatureDataSchema,
  FeatureListResponseSchema,
  FeatureRecordResponseSchema,
  FeatureOutputResponseSchema,
  FeatureDeleteResponseSchema,
  FeatureTitleResponseSchema,
  FeatureExportResponseSchema,
  FeatureOperationResultSchema,
  FeatureBulkUpdateResponseSchema,
  FeatureBulkDeleteResponseSchema,
  FeatureImportResponseSchema,
  FeatureBulkResolveResponseSchema,
  FeatureConflictResponseSchema,
  FeatureOrphanedResponseSchema,
} from '../src/domains/feature-responses.js';

it('preserves the extensible feature record and envelope extensions without inventing title/status/ID enums', () => {
  const feature = {
    id: 'opaque : / []',
    title: { old: 'shape' },
    status: ['legacy'],
    custom: { nested: [null, 4] },
  };
  expect(PublicFeatureDataSchema.parse(feature)).toEqual(feature);
  expect(
    FeatureRecordResponseSchema.parse({ success: true, feature, legacyMetadata: ['kept'] })
  ).toEqual({ success: true, feature, legacyMetadata: ['kept'] });
  expect(
    FeatureListResponseSchema.parse({ success: true, features: [{}, feature] }).features
  ).toEqual([{}, feature]);
  expect(
    FeatureOrphanedResponseSchema.parse({
      success: true,
      orphanedFeatures: [{ feature, missingBranch: 'old branch', extra: true }],
    }).orphanedFeatures[0].extra
  ).toBe(true);
  for (const invalid of [null, [], 'feature', 4])
    expect(PublicFeatureDataSchema.safeParse(invalid).success).toBe(false);
});

it('validates actual scalar/output/export wire fields without decoding opaque serialized data', () => {
  for (const content of [null, '', 'text\n'])
    expect(FeatureOutputResponseSchema.parse({ success: true, content }).content).toBe(content);
  expect(FeatureDeleteResponseSchema.parse({ success: false }).success).toBe(false);
  expect(FeatureTitleResponseSchema.parse({ success: true, title: 'Title' }).title).toBe('Title');
  for (const format of ['json', 'yaml'] as const)
    expect(
      FeatureExportResponseSchema.parse({
        success: true,
        data: 'serialized payload',
        format,
        contentType: format === 'json' ? 'application/json' : 'application/x-yaml',
        filename: `features-export.${format}`,
      }).format
    ).toBe(format);
  expect(
    FeatureExportResponseSchema.safeParse({
      success: true,
      data: '{}',
      format: 'json',
      contentType: 'application/x-yaml',
      filename: 'features-export.json',
    }).success
  ).toBe(false);
  expect(FeatureTitleResponseSchema.safeParse({ success: true, title: '' }).success).toBe(false);
});

it('retains partial and empty bulk outcomes with coherent counts and optional legacy result fields', () => {
  const results = [
    { featureId: 'opaque:1', success: true, extra: true },
    { featureId: 'opaque:2', success: false, error: 'Existing failure' },
  ];
  expect(
    FeatureBulkUpdateResponseSchema.parse({
      success: false,
      updatedCount: 1,
      failedCount: 1,
      results,
      features: [{ custom: true }],
    }).results[0].extra
  ).toBe(true);
  FeatureBulkDeleteResponseSchema.parse({
    success: false,
    deletedCount: 1,
    failedCount: 1,
    results,
  });
  FeatureBulkResolveResponseSchema.parse({
    success: false,
    resolvedCount: 1,
    failedCount: 1,
    results,
  });
  FeatureImportResponseSchema.parse({
    success: false,
    importedCount: 1,
    failedCount: 1,
    results: [
      {
        success: true,
        featureId: 'opaque:1',
        importedAt: 'legacy timestamp',
        warnings: ['kept'],
        wasOverwritten: true,
      },
      { success: false, importedAt: 'legacy timestamp', errors: ['failed'] },
    ],
  });
  FeatureImportResponseSchema.parse({
    success: true,
    importedCount: 0,
    failedCount: 0,
    results: [],
  });
  FeatureOperationResultSchema.parse({ featureId: 'opaque:[]', success: false, extra: true });
  expect(
    FeatureBulkDeleteResponseSchema.safeParse({
      success: true,
      deletedCount: 0,
      failedCount: 0,
      results,
    }).success
  ).toBe(false);
  expect(
    FeatureBulkUpdateResponseSchema.safeParse({
      success: false,
      updatedCount: 1,
      failedCount: 1,
      results,
      features: [],
    }).success
  ).toBe(false);
});

it('checks conflict record/counter coherence while preserving unknown legacy title values', () => {
  FeatureConflictResponseSchema.parse({
    success: true,
    hasConflicts: true,
    conflicts: [
      { featureId: 'opaque:[]', title: { legacy: true }, existingTitle: 4, hasConflict: true },
    ],
    totalFeatures: 1,
    conflictCount: 1,
  });
  expect(
    FeatureConflictResponseSchema.safeParse({
      success: true,
      hasConflicts: false,
      conflicts: [],
      totalFeatures: 1,
      conflictCount: 0,
    }).success
  ).toBe(false);
  expect(
    FeatureImportResponseSchema.safeParse({
      success: true,
      importedCount: 1,
      failedCount: 0,
      results: [{ success: true }],
    }).success
  ).toBe(false);
});
