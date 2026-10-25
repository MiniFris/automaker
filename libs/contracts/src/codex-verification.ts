import { z } from 'zod';
import { ProjectPathSchema } from './common.js';
export const CodexVerificationTargetSchema = z
  .object({
    kind: z.literal('host-codex-verification'),
    provider: z.literal('codex'),
    instanceId: z.string().uuid(),
    workingDirectory: ProjectPathSchema,
    authMethod: z.enum(['cli', 'api_key']),
    credentialKind: z.enum(['api-key', 'chatgpt', 'not-detected']),
    credentialDirectory: ProjectPathSchema.optional(),
    endpoint: z.string().url().max(2048),
    model: z.literal('gpt-5.2-codex'),
  })
  .strict()
  .refine(
    (value) =>
      value.authMethod === 'cli'
        ? !!value.credentialDirectory
        : value.credentialDirectory === undefined && value.credentialKind === 'api-key',
    'Credential metadata must match the verification mode.'
  );
export const CodexVerificationTargetResponseSchema = z
  .object({
    success: z.literal(true),
    protocolVersion: z.literal(1),
    target: CodexVerificationTargetSchema,
  })
  .strict();
export const CodexVerificationRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: CodexVerificationTargetSchema,
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .regex(/^[^\x00-\x1f\x7f]+$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.target.authMethod === 'api_key' || value.apiKey === undefined,
    'CLI verification must not include an API key.'
  );
export const CodexVerificationResponseSchema = z
  .object({
    success: z.literal(true),
    authenticated: z.boolean(),
    target: CodexVerificationTargetSchema,
    authType: z.enum(['cli', 'api_key']),
    verification: z.enum(['verified', 'unverified']),
    error: z.string().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.authenticated === (value.verification === 'verified') &&
      value.authType === value.target.authMethod,
    'Verification evidence must match authentication status and mode.'
  );
export type CodexVerificationTarget = z.infer<typeof CodexVerificationTargetSchema>;
export type CodexVerificationRequest = z.infer<typeof CodexVerificationRequestSchema>;
export type CodexVerificationResponse = z.infer<typeof CodexVerificationResponseSchema>;
