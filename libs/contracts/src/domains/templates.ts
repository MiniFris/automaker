import { z } from 'zod';
import { ProjectPathSchema } from '../common.js';

export const CloneTemplateRequestSchema = z
  .object({
    repoUrl: z.string().regex(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/),
    projectName: z.string().trim().min(1).max(255),
    parentDir: ProjectPathSchema,
  })
  .strict();

export type CloneTemplateRequest = z.infer<typeof CloneTemplateRequestSchema>;

export const CloneTemplateResponseSchema = z.looseObject({
  success: z.literal(true),
  projectPath: z.string(),
  projectName: z.string(),
});
export type CloneTemplateResponse = z.infer<typeof CloneTemplateResponseSchema>;
