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
