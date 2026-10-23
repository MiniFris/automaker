import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const CloneTemplateRequestSchema = z
  .object({
    repoUrl: z.string().regex(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/),
    projectName: z.string().trim().min(1).max(255),
    parentDir: ProjectPathSchema,
  })
  .strict();

export type CloneTemplateRequest = z.infer<typeof CloneTemplateRequestSchema>;
