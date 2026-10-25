import { z } from 'zod';
import { ProjectPathSchema } from './common.js';

export const ClaudeVerificationTargetSchema = z
  .object({
    kind: z.literal('host-claude-verification'),
    provider: z.literal('claude'),
    instanceId: z.string().uuid(),
    workingDirectory: ProjectPathSchema,
    authMethod: z.enum(['cli', 'api_key']),
    endpoint: z.string().url().max(2048),
    model: z.literal('claude-sonnet-4-6'),
  })
  .strict();
export const ClaudeVerificationTargetResponseSchema = z
  .object({
    success: z.literal(true),
    protocolVersion: z.literal(1),
    target: ClaudeVerificationTargetSchema,
  })
  .strict();
export const ClaudeVerificationRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: ClaudeVerificationTargetSchema,
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
    (input) => input.target.authMethod === 'api_key' || input.apiKey === undefined,
    'CLI verification must not include an API key.'
  );
export const ClaudeVerificationResponseSchema = z
  .object({
    success: z.literal(true),
    authenticated: z.boolean(),
    target: ClaudeVerificationTargetSchema,
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
export type ClaudeVerificationTarget = z.infer<typeof ClaudeVerificationTargetSchema>;
export type ClaudeVerificationRequest = z.infer<typeof ClaudeVerificationRequestSchema>;
export type ClaudeVerificationResponse = z.infer<typeof ClaudeVerificationResponseSchema>;
