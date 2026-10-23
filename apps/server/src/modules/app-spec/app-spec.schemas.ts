import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

const generationOptions = {
  generateFeatures: z.boolean().optional().default(false),
  analyzeProject: z.boolean().optional().default(true),
  maxFeatures: z.number().int().min(1).max(1_000).optional(),
};

export const AppSpecCreateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    projectOverview: z.string().trim().min(1).max(2_000_000),
    ...generationOptions,
  })
  .strict();
export type AppSpecCreateRequest = z.infer<typeof AppSpecCreateSchema>;

export const AppSpecGenerateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    projectDefinition: z.string().trim().min(1).max(2_000_000),
    ...generationOptions,
  })
  .strict();
export type AppSpecGenerateRequest = z.infer<typeof AppSpecGenerateSchema>;

export const AppSpecProjectSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export type AppSpecProjectRequest = z.infer<typeof AppSpecProjectSchema>;

export const AppSpecFeaturesSchema = z
  .object({
    projectPath: ProjectPathSchema,
    maxFeatures: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();
export type AppSpecFeaturesRequest = z.infer<typeof AppSpecFeaturesSchema>;

export const AppSpecStopSchema = z.object({ projectPath: ProjectPathSchema.optional() }).strict();
export type AppSpecStopRequest = z.infer<typeof AppSpecStopSchema>;

export const AppSpecStatusSchema = z.object({ projectPath: ProjectPathSchema.optional() }).strict();
export type AppSpecStatusRequest = z.infer<typeof AppSpecStatusSchema>;
