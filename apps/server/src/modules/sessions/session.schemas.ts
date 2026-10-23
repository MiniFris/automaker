import { z } from 'zod';
import { ProjectPathSchema } from '@automaker/contracts';

export const SessionIdSchema = z.string().trim().min(1).max(255);
export const SessionParamsSchema = z.object({ sessionId: SessionIdSchema }).strict();
export type SessionParams = z.infer<typeof SessionParamsSchema>;

export const SessionListQuerySchema = z
  .object({ includeArchived: z.enum(['true', 'false']).optional().default('false') })
  .strict();
export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

export const SessionCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    projectPath: ProjectPathSchema.optional(),
    workingDirectory: ProjectPathSchema.optional(),
    model: z.string().trim().min(1).max(255).optional(),
    providerId: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type SessionCreateRequest = z.infer<typeof SessionCreateSchema>;

export const SessionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    model: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one update field is required',
  });
export type SessionUpdateRequest = z.infer<typeof SessionUpdateSchema>;
