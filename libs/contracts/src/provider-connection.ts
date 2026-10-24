import { z } from 'zod';

export const CliConnectionProviderSchema = z.enum([
  'claude',
  'codex',
  'cursor',
  'gemini',
  'copilot',
  'opencode',
]);
export const ProviderConnectionTargetSchema = z
  .object({
    kind: z.literal('host-application'),
    instanceId: z.uuid(),
    provider: CliConnectionProviderSchema,
    workingDirectory: z.string().min(1),
  })
  .strict();
export const ProviderConnectionTargetResponseSchema = z
  .object({
    success: z.literal(true),
    target: ProviderConnectionTargetSchema,
  })
  .strict();
export const ProviderDisconnectRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: ProviderConnectionTargetSchema,
  })
  .strict();
export const ProviderDisconnectResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    connected: z.literal(false),
    target: ProviderConnectionTargetSchema,
  })
  .strict();

export type CliConnectionProvider = z.infer<typeof CliConnectionProviderSchema>;
export type ProviderConnectionTarget = z.infer<typeof ProviderConnectionTargetSchema>;
export type ProviderDisconnectRequest = z.infer<typeof ProviderDisconnectRequestSchema>;
export type ProviderDisconnectResponse = z.infer<typeof ProviderDisconnectResponseSchema>;
