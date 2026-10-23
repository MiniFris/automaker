import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const DescribeFileRequestSchema = z.object({ filePath: ProjectPathSchema }).strict();
export type DescribeFileRequest = z.infer<typeof DescribeFileRequestSchema>;

export const DescribeImageRequestSchema = z.object({ imagePath: ProjectPathSchema }).strict();
export type DescribeImageRequest = z.infer<typeof DescribeImageRequestSchema>;
