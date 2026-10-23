import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const GitProjectSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export const GitFileSchema = z
  .object({ projectPath: ProjectPathSchema, filePath: z.string().trim().min(1).max(32_768) })
  .strict();
export const GitDetailsSchema = z
  .object({
    projectPath: ProjectPathSchema,
    filePath: z.string().trim().min(1).max(32_768).optional(),
  })
  .strict();
export const GitStageFilesSchema = z
  .object({
    projectPath: ProjectPathSchema,
    files: z.array(z.string().trim().min(1).max(32_768)).min(1).max(1_000),
    operation: z.enum(['stage', 'unstage']),
    environmentTargetId: z.string().optional(),
  })
  .strict();

export type GitProjectRequest = z.infer<typeof GitProjectSchema>;
export type GitFileRequest = z.infer<typeof GitFileSchema>;
export type GitDetailsRequest = z.infer<typeof GitDetailsSchema>;
export type GitStageFilesRequest = z.infer<typeof GitStageFilesSchema>;
