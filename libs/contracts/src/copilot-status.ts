import { z } from 'zod';

/** Passive inspection is never an account or Copilot entitlement verification. */
export const CopilotStatusAuthSchema = z
  .object({
    authenticated: z.literal(false),
    authenticationChecked: z.literal(false),
    method: z.enum(['oauth', 'none']),
    hasEnvToken: z.boolean(),
    hasConfigFile: z.boolean(),
    error: z.literal('Local configuration could not be inspected.').optional(),
  })
  .strict();

export const CopilotSetupStatusSchema = z
  .object({
    success: z.literal(true),
    installed: z.boolean(),
    connected: z.boolean(),
    version: z.string().nullable(),
    path: z.string().nullable(),
    auth: CopilotStatusAuthSchema,
    installCommand: z.literal('npm install -g @github/copilot'),
    loginCommand: z.literal('gh auth login'),
  })
  .strict();

export type CopilotSetupStatus = z.infer<typeof CopilotSetupStatusSchema>;
