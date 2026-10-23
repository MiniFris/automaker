import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const FilePathRequestSchema = z.object({ filePath: ProjectPathSchema }).strict();
export type FilePathRequest = z.infer<typeof FilePathRequestSchema>;

export const DirectoryPathRequestSchema = z.object({ dirPath: ProjectPathSchema }).strict();
export type DirectoryPathRequest = z.infer<typeof DirectoryPathRequestSchema>;
