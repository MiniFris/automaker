import { z } from 'zod';

const optionalWorkspaceFields = {
  workspaceDir: z.string().optional(),
  defaultDir: z.string().nullable().optional(),
  error: z.string().optional(),
};

/** All existing configured, default-only and diagnostic success envelopes. */
export const WorkspaceConfigResponseSchema = z.union([
  z.looseObject({
    ...optionalWorkspaceFields,
    success: z.literal(true),
    configured: z.literal(true),
    workspaceDir: z.string(),
    defaultDir: z.string(),
  }),
  z.looseObject({
    ...optionalWorkspaceFields,
    success: z.literal(true),
    configured: z.literal(false),
    defaultDir: z.string().nullable(),
  }),
  z.looseObject({
    ...optionalWorkspaceFields,
    success: z.literal(true),
    configured: z.literal(false),
    error: z.string(),
  }),
]);

export const WorkspaceDirectoriesResponseSchema = z.looseObject({
  success: z.literal(true),
  directories: z.array(z.looseObject({ name: z.string(), path: z.string() })),
});

export type WorkspaceConfigResponse = z.infer<typeof WorkspaceConfigResponseSchema>;
export type WorkspaceDirectoriesResponse = z.infer<typeof WorkspaceDirectoriesResponseSchema>;
