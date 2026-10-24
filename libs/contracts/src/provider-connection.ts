import { z } from 'zod';
export const PROVIDER_CONNECTION_PROTOCOL_VERSION = 3 as const;

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
    protocolVersion: z.literal(PROVIDER_CONNECTION_PROTOCOL_VERSION),
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
export const ProviderReconnectRequestSchema = ProviderDisconnectRequestSchema;
export const ProviderReconnectResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
    connected: z.literal(true),
    target: ProviderConnectionTargetSchema,
    credentialStatus: z.enum(['present-unverified', 'not-detected', 'not-inspected']),
    wasAlreadyAuthenticated: z.boolean().optional(),
    requiresManualAuth: z.boolean().optional(),
  })
  .strict();

export type CliConnectionProvider = z.infer<typeof CliConnectionProviderSchema>;
export type ProviderConnectionTarget = z.infer<typeof ProviderConnectionTargetSchema>;
export type ProviderDisconnectRequest = z.infer<typeof ProviderDisconnectRequestSchema>;
export type ProviderDisconnectResponse = z.infer<typeof ProviderDisconnectResponseSchema>;
export type ProviderReconnectRequest = z.infer<typeof ProviderReconnectRequestSchema>;
export type ProviderReconnectResponse = z.infer<typeof ProviderReconnectResponseSchema>;
