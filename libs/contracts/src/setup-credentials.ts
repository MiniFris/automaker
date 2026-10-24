import { z } from 'zod';
import { ProjectPathSchema } from './common.js';
export const SetupCredentialProviderSchema = z.enum([
  'anthropic',
  'openai',
  'anthropic_oauth_token',
]);
export const SetupCredentialTargetSchema = z
  .object({
    kind: z.literal('application-credential'),
    provider: SetupCredentialProviderSchema,
    instanceId: z.string().uuid(),
    workingDirectory: ProjectPathSchema,
    credentialsPath: ProjectPathSchema,
  })
  .strict();
export const SetupCredentialTargetResponseSchema = z
  .object({
    success: z.literal(true),
    protocolVersion: z.literal(1),
    target: SetupCredentialTargetSchema,
  })
  .strict();
export const SetupCredentialStoreRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: SetupCredentialTargetSchema,
    apiKey: z
      .string()
      .trim()
      .min(20)
      .max(8192)
      .regex(/^[\x21-\x7e]+$/)
      .refine((value) => !value.includes('...'), 'Masked values are not credentials.'),
  })
  .strict()
  .refine(
    ({ target, apiKey }) =>
      target.provider === 'anthropic_oauth_token' ||
      apiKey.startsWith(target.provider === 'anthropic' ? 'sk-ant-' : 'sk-'),
    'Credential format does not match provider.'
  );
export const SetupCredentialDeleteRequestSchema = z
  .object({ confirmed: z.literal(true), target: SetupCredentialTargetSchema })
  .strict();
export const SetupCredentialMutationResponseSchema = z
  .object({
    success: z.literal(true),
    target: SetupCredentialTargetSchema,
    operation: z.enum(['store', 'delete']),
    configured: z.boolean(),
    storage: z.literal('managed-credentials'),
  })
  .strict()
  .refine(
    (value) => value.configured === (value.operation === 'store'),
    'Credential result must match operation.'
  );
export type SetupCredentialTarget = z.infer<typeof SetupCredentialTargetSchema>;
export type SetupCredentialStoreRequest = z.infer<typeof SetupCredentialStoreRequestSchema>;
export type SetupCredentialDeleteRequest = z.infer<typeof SetupCredentialDeleteRequestSchema>;
