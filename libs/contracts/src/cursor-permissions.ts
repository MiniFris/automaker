import { z } from 'zod';
import { ProjectPathSchema } from './common.js';

export const CursorPermissionsSchema = z
  .object({
    allow: z.array(z.string().min(1).max(4096)).max(1000),
    deny: z.array(z.string().min(1).max(4096)).max(1000),
  })
  .strict();
const identity = {
  kind: z.literal('host-cursor-permissions'),
  provider: z.literal('cursor'),
  instanceId: z.string().uuid(),
  workingDirectory: ProjectPathSchema,
  configPath: ProjectPathSchema,
};
export const CursorPermissionsTargetSchema = z.discriminatedUnion('scope', [
  z.object({ ...identity, scope: z.literal('global') }).strict(),
  z.object({ ...identity, scope: z.literal('project'), projectPath: ProjectPathSchema }).strict(),
]);
export const CursorPermissionsTargetResponseSchema = z
  .object({
    success: z.literal(true),
    protocolVersion: z.literal(1),
    target: CursorPermissionsTargetSchema,
  })
  .strict();
export const CursorProfileRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: CursorPermissionsTargetSchema,
    profileId: z.enum(['strict', 'development']),
  })
  .strict();
export const CursorCustomPermissionsRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: CursorPermissionsTargetSchema,
    permissions: CursorPermissionsSchema,
  })
  .strict()
  .refine((value) => value.target.scope === 'project', 'Custom permissions require project scope.');
export const CursorDeletePermissionsRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: CursorPermissionsTargetSchema,
  })
  .strict()
  .refine((value) => value.target.scope === 'project', 'Only project permissions can be deleted.');
export const CursorPermissionsMutationResponseSchema = z
  .object({
    success: z.literal(true),
    target: CursorPermissionsTargetSchema,
    message: z.string(),
    scope: z.enum(['global', 'project']).optional(),
    profileId: z.enum(['strict', 'development']).optional(),
    permissions: CursorPermissionsSchema.optional(),
  })
  .strict();
export type CursorPermissionsTarget = z.infer<typeof CursorPermissionsTargetSchema>;
export type CursorProfileRequest = z.infer<typeof CursorProfileRequestSchema>;
export type CursorCustomPermissionsRequest = z.infer<typeof CursorCustomPermissionsRequestSchema>;
export type CursorDeletePermissionsRequest = z.infer<typeof CursorDeletePermissionsRequestSchema>;
