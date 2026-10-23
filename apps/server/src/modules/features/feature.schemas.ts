import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const FeatureIdSchema = z.string().trim().min(1).max(255);
export const ProjectFeatureSchema = z
  .object({ projectPath: ProjectPathSchema, featureId: FeatureIdSchema })
  .strict();
export type ProjectFeatureRequest = z.infer<typeof ProjectFeatureSchema>;

export const FeatureListSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export type FeatureListRequest = z.infer<typeof FeatureListSchema>;

export const FeatureExportSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(FeatureIdSchema).max(10_000).optional(),
    format: z.enum(['json', 'yaml']).default('json'),
    includeHistory: z.boolean().default(true),
    includePlanSpec: z.boolean().default(true),
    category: z.string().max(255).optional(),
    status: z.string().max(64).optional(),
    prettyPrint: z.boolean().default(true),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type FeatureExportRequest = z.infer<typeof FeatureExportSchema>;

export const FeatureConflictCheckSchema = z
  .object({
    projectPath: ProjectPathSchema,
    data: z
      .string()
      .min(1)
      .max(50 * 1024 * 1024),
  })
  .strict();
export type FeatureConflictCheckRequest = z.infer<typeof FeatureConflictCheckSchema>;

const FeatureDataSchema = z.object({}).catchall(z.unknown());

export const FeatureCreateSchema = z
  .object({ projectPath: ProjectPathSchema, feature: FeatureDataSchema })
  .strict();
export type FeatureCreateRequest = z.infer<typeof FeatureCreateSchema>;

export const FeatureUpdateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureId: FeatureIdSchema,
    updates: FeatureDataSchema.refine((value) => Object.keys(value).length > 0, {
      message: 'updates must contain at least one field',
    }),
    descriptionHistorySource: z.enum(['enhance', 'edit']).optional(),
    enhancementMode: z
      .enum(['improve', 'technical', 'simplify', 'acceptance', 'ux-reviewer'])
      .optional(),
    preEnhancementDescription: z.string().max(1_000_000).optional(),
  })
  .strict();
export type FeatureUpdateRequest = z.infer<typeof FeatureUpdateSchema>;

export const FeatureBulkUpdateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(FeatureIdSchema).min(1).max(10_000),
    updates: FeatureDataSchema.refine((value) => Object.keys(value).length > 0, {
      message: 'updates must contain at least one field',
    }),
  })
  .strict();
export type FeatureBulkUpdateRequest = z.infer<typeof FeatureBulkUpdateSchema>;

export const FeatureBulkDeleteSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(FeatureIdSchema).min(1).max(10_000),
  })
  .strict();
export type FeatureBulkDeleteRequest = z.infer<typeof FeatureBulkDeleteSchema>;

export const FeatureImportSchema = z
  .object({
    projectPath: ProjectPathSchema,
    data: z
      .string()
      .min(1)
      .max(50 * 1024 * 1024),
    overwrite: z.boolean().default(false),
    preserveBranchInfo: z.boolean().default(false),
    targetCategory: z.string().max(255).optional(),
  })
  .strict();
export type FeatureImportRequest = z.infer<typeof FeatureImportSchema>;

export const FeatureTitleSchema = z
  .object({
    description: z.string().trim().min(1).max(1_000_000),
    projectPath: ProjectPathSchema.optional(),
  })
  .strict();
export type FeatureTitleRequest = z.infer<typeof FeatureTitleSchema>;

export const OrphanResolveActionSchema = z.enum(['delete', 'create-worktree', 'move-to-branch']);
export const OrphanResolveSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureId: FeatureIdSchema,
    action: OrphanResolveActionSchema,
    targetBranch: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();
export type OrphanResolveRequest = z.infer<typeof OrphanResolveSchema>;

export const OrphanBulkResolveSchema = z
  .object({
    projectPath: ProjectPathSchema,
    featureIds: z.array(FeatureIdSchema).min(1).max(10_000),
    action: OrphanResolveActionSchema,
    targetBranch: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();
export type OrphanBulkResolveRequest = z.infer<typeof OrphanBulkResolveSchema>;
