import { z } from 'zod';
import { ProjectPathSchema } from '../common.js';

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

export const BrowseRequestSchema = z.object({ dirPath: ProjectPathSchema.optional() }).strict();
export type BrowseRequest = z.infer<typeof BrowseRequestSchema>;

export const BrowseProjectRequestSchema = z
  .object({ projectPath: ProjectPathSchema, relativePath: z.string().max(4096).optional() })
  .strict();
export type BrowseProjectRequest = z.infer<typeof BrowseProjectRequestSchema>;

export const ResolveDirectoryRequestSchema = z
  .object({
    directoryName: z.string().trim().min(1).max(4096),
    sampleFiles: z.array(z.string().max(4096)).max(100).optional(),
    fileCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ResolveDirectoryRequest = z.infer<typeof ResolveDirectoryRequestSchema>;

export const SaveImageRequestSchema = z
  .object({
    data: z
      .string()
      .min(1)
      .max(28 * 1024 * 1024),
    filename: z.string().trim().min(1).max(255),
    // Existing browser clients send this hint; storage validates the extension.
    mimeType: z.string().max(255).optional(),
    projectPath: ProjectPathSchema,
  })
  .strict();
export type SaveImageRequest = z.infer<typeof SaveImageRequestSchema>;

export const ProjectPathRequestSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export type ProjectPathRequest = z.infer<typeof ProjectPathRequestSchema>;

export const ImageQuerySchema = z
  .object({ path: z.string().min(1).max(4096), projectPath: ProjectPathSchema.optional() })
  .strict();
export type ImageQuery = z.infer<typeof ImageQuerySchema>;
