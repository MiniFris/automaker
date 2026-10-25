import { z } from 'zod';

export const CursorStatusAuthSchema = z
  .object({
    authenticated: z.literal(false),
    authenticationChecked: z.literal(false),
    scope: z.literal('host'),
    method: z.enum(['api_key', 'none']),
    hasEnvApiKey: z.boolean(),
    hasCredentialsFile: z.boolean(),
    error: z.literal('Local configuration could not be inspected.').optional(),
  })
  .strict();
export const CursorSetupStatusSchema = z
  .object({
    success: z.literal(true),
    installed: z.boolean(),
    connected: z.boolean(),
    version: z.string().nullable(),
    path: z.string().nullable(),
    auth: CursorStatusAuthSchema,
    installCommand: z.literal('curl https://cursor.com/install -fsS | bash'),
    loginCommand: z.literal('cursor-agent login'),
  })
  .strict();
export type CursorSetupStatus = z.infer<typeof CursorSetupStatusSchema>;
