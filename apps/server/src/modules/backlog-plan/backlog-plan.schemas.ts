import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

const FeatureChangeDataSchema = z.object({}).catchall(z.unknown());
const BacklogChangeSchema = z
  .object({
    type: z.enum(['add', 'update', 'delete']),
    featureId: z.string().trim().min(1).max(255).optional(),
    feature: FeatureChangeDataSchema.optional(),
    reason: z.string().max(100_000).default(''),
  })
  .strict();
const DependencyUpdateSchema = z
  .object({
    featureId: z.string().trim().min(1).max(255),
    removedDependencies: z.array(z.string().trim().min(1).max(255)).max(10_000),
    addedDependencies: z.array(z.string().trim().min(1).max(255)).max(10_000),
  })
  .strict();

export const BacklogPlanSchema = z
  .object({
    changes: z.array(BacklogChangeSchema).max(10_000),
    summary: z.string().max(1_000_000).default(''),
    dependencyUpdates: z.array(DependencyUpdateSchema).max(10_000).default([]),
  })
  .strict();

export const BacklogGenerateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    prompt: z.string().trim().min(1).max(2_000_000),
    model: z.string().trim().min(1).max(255).optional(),
    branchName: z.string().trim().min(1).max(255).optional(),
    providerId: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type BacklogGenerateRequest = z.infer<typeof BacklogGenerateSchema>;

export const BacklogProjectSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export type BacklogProjectRequest = z.infer<typeof BacklogProjectSchema>;

export const BacklogApplySchema = z
  .object({
    projectPath: ProjectPathSchema,
    plan: BacklogPlanSchema,
    branchName: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type BacklogApplyRequest = z.infer<typeof BacklogApplySchema>;
