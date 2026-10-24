import { z } from 'zod';

export const GeminiStatusAuthSchema = z
  .object({
    authenticated: z.literal(false),
    authenticationChecked: z.literal(false),
    method: z.enum(['api_key', 'vertex_ai', 'none']),
    hasApiKey: z.boolean(),
    hasEnvApiKey: z.boolean(),
    hasConfigFile: z.boolean(),
    hasVertexConfig: z.boolean(),
    error: z.literal('Local configuration could not be inspected.').optional(),
  })
  .strict();

export const GeminiSetupStatusSchema = z
  .object({
    success: z.literal(true),
    installed: z.boolean(),
    connected: z.boolean(),
    version: z.string().nullable(),
    path: z.string().nullable(),
    auth: GeminiStatusAuthSchema,
    installCommand: z.literal('npm install -g @google/gemini-cli'),
    loginCommand: z.literal('gemini'),
  })
  .strict();

export type GeminiSetupStatus = z.infer<typeof GeminiSetupStatusSchema>;
