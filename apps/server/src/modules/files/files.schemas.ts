import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const FilePathRequestSchema = z.object({ filePath: ProjectPathSchema }).strict();
export type FilePathRequest = z.infer<typeof FilePathRequestSchema>;

export const DirectoryPathRequestSchema = z.object({ dirPath: ProjectPathSchema }).strict();
export type DirectoryPathRequest = z.infer<typeof DirectoryPathRequestSchema>;

export const WriteFileRequestSchema = z
  .object({ filePath: ProjectPathSchema, content: z.string().default('') })
  .strict();
export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>;

export const TransferFileRequestSchema = z
  .object({
    sourcePath: ProjectPathSchema,
    destinationPath: ProjectPathSchema,
    overwrite: z.boolean().optional().default(false),
  })
  .strict();
export type TransferFileRequest = z.infer<typeof TransferFileRequestSchema>;
