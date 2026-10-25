import { z } from 'zod';
import { ProjectPathSchema } from '../common.js';

export const DescribeFileRequestSchema = z.object({ filePath: ProjectPathSchema }).strict();
export type DescribeFileRequest = z.infer<typeof DescribeFileRequestSchema>;

export const DescribeImageRequestSchema = z.object({ imagePath: ProjectPathSchema }).strict();
export type DescribeImageRequest = z.infer<typeof DescribeImageRequestSchema>;

/** Both native operations return the generated text; preserve future envelope extensions. */
export const ContextDescriptionResponseSchema = z
  .object({
    success: z.literal(true),
    description: z.string(),
  })
  .passthrough();
export const DescribeFileResponseSchema = ContextDescriptionResponseSchema;
export const DescribeImageResponseSchema = ContextDescriptionResponseSchema;
export type ContextDescriptionResponse = z.infer<typeof ContextDescriptionResponseSchema>;
export type DescribeFileResponse = z.infer<typeof DescribeFileResponseSchema>;
export type DescribeImageResponse = z.infer<typeof DescribeImageResponseSchema>;
