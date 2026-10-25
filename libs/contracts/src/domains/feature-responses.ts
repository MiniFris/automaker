import { z } from 'zod';

/** Feature storage deliberately permits user-defined fields and legacy field values. */
export const PublicFeatureDataSchema = z.record(z.string(), z.unknown());
const count = z.number().int().nonnegative();
const success = z.literal(true);

export const FeatureListResponseSchema = z
  .object({ success, features: z.array(PublicFeatureDataSchema) })
  .passthrough();
export const FeatureRecordResponseSchema = z
  .object({ success, feature: PublicFeatureDataSchema })
  .passthrough();
export const FeatureOutputResponseSchema = z
  .object({ success, content: z.string().nullable() })
  .passthrough();
export const FeatureDeleteResponseSchema = z.object({ success: z.boolean() }).passthrough();
export const FeatureTitleResponseSchema = z
  .object({ success, title: z.string().min(1) })
  .passthrough();
export const FeatureExportResponseSchema = z.discriminatedUnion('format', [
  z
    .object({
      success,
      data: z.string(),
      format: z.literal('json'),
      contentType: z.literal('application/json'),
      filename: z.literal('features-export.json'),
    })
    .passthrough(),
  z
    .object({
      success,
      data: z.string(),
      format: z.literal('yaml'),
      contentType: z.literal('application/x-yaml'),
      filename: z.literal('features-export.yaml'),
    })
    .passthrough(),
]);
export const FeatureOperationResultSchema = z
  .object({
    featureId: z.string(),
    success: z.boolean(),
    action: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export const FeatureImportResultSchema = z
  .object({
    success: z.boolean(),
    featureId: z.string().optional(),
    importedAt: z.string(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
    wasOverwritten: z.boolean().optional(),
  })
  .passthrough();

function coherentSummary(countKey: string) {
  return (
    value: {
      success: boolean;
      failedCount: number;
      results: { success: boolean }[];
      [key: string]: unknown;
    },
    context: z.RefinementCtx
  ) => {
    const succeeded = value.results.filter((result) => result.success).length;
    if (
      value[countKey] !== succeeded ||
      value.failedCount !== value.results.length - succeeded ||
      value.success !== (succeeded === value.results.length)
    )
      context.addIssue({
        code: 'custom',
        message: 'Feature operation counts do not match its results.',
      });
  };
}
export const FeatureBulkUpdateResponseSchema = z
  .object({
    success: z.boolean(),
    updatedCount: count,
    failedCount: count,
    results: z.array(FeatureOperationResultSchema),
    features: z.array(PublicFeatureDataSchema),
  })
  .passthrough()
  .superRefine(coherentSummary('updatedCount'))
  .superRefine((value, context) => {
    if (value.features.length !== value.updatedCount)
      context.addIssue({
        code: 'custom',
        message: 'Updated features do not match the successful operation count.',
      });
  });
export const FeatureBulkDeleteResponseSchema = z
  .object({
    success: z.boolean(),
    deletedCount: count,
    failedCount: count,
    results: z.array(FeatureOperationResultSchema),
  })
  .passthrough()
  .superRefine(coherentSummary('deletedCount'));
export const FeatureImportResponseSchema = z
  .object({
    success: z.boolean(),
    importedCount: count,
    failedCount: count,
    results: z.array(FeatureImportResultSchema),
  })
  .passthrough()
  .superRefine(coherentSummary('importedCount'));
export const FeatureBulkResolveResponseSchema = z
  .object({
    success: z.boolean(),
    resolvedCount: count,
    failedCount: count,
    results: z.array(FeatureOperationResultSchema),
  })
  .passthrough()
  .superRefine(coherentSummary('resolvedCount'));
export const FeatureConflictResponseSchema = z
  .object({
    success,
    hasConflicts: z.boolean(),
    conflicts: z.array(
      z
        .object({
          featureId: z.string(),
          title: z.unknown().optional(),
          existingTitle: z.unknown().optional(),
          hasConflict: z.boolean(),
        })
        .passthrough()
    ),
    totalFeatures: count,
    conflictCount: count,
  })
  .passthrough()
  .superRefine((value, context) => {
    const conflicts = value.conflicts.filter((item) => item.hasConflict).length;
    if (
      value.totalFeatures !== value.conflicts.length ||
      value.conflictCount !== conflicts ||
      value.hasConflicts !== conflicts > 0
    )
      context.addIssue({
        code: 'custom',
        message: 'Feature conflict counts do not match its records.',
      });
  });
export const FeatureOrphanedResponseSchema = z
  .object({
    success,
    orphanedFeatures: z.array(
      z.object({ feature: PublicFeatureDataSchema, missingBranch: z.string() }).passthrough()
    ),
  })
  .passthrough();

export type PublicFeatureData = z.infer<typeof PublicFeatureDataSchema>;
export type FeatureListResponse = z.infer<typeof FeatureListResponseSchema>;
export type FeatureRecordResponse = z.infer<typeof FeatureRecordResponseSchema>;
export type FeatureOutputResponse = z.infer<typeof FeatureOutputResponseSchema>;
export type FeatureDeleteResponse = z.infer<typeof FeatureDeleteResponseSchema>;
export type FeatureTitleResponse = z.infer<typeof FeatureTitleResponseSchema>;
export type FeatureExportResponse = z.infer<typeof FeatureExportResponseSchema>;
export type FeatureBulkUpdateResponse = z.infer<typeof FeatureBulkUpdateResponseSchema>;
export type FeatureBulkDeleteResponse = z.infer<typeof FeatureBulkDeleteResponseSchema>;
export type FeatureImportResponse = z.infer<typeof FeatureImportResponseSchema>;
export type FeatureBulkResolveResponse = z.infer<typeof FeatureBulkResolveResponseSchema>;
export type FeatureConflictResponse = z.infer<typeof FeatureConflictResponseSchema>;
export type FeatureOrphanedResponse = z.infer<typeof FeatureOrphanedResponseSchema>;
