import { z } from 'zod';
import { ProjectPathSchema } from './common.js';

export const GithubAuthenticationTargetSchema = z
  .object({
    kind: z.literal('host-github-authentication'),
    provider: z.literal('github'),
    instanceId: z.string().uuid(),
    workingDirectory: ProjectPathSchema,
    cliPath: ProjectPathSchema.nullable(),
    hostname: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9][A-Za-z0-9.:-]*$/),
  })
  .strict();
export const GithubAuthenticationTargetResponseSchema = z
  .object({
    success: z.literal(true),
    protocolVersion: z.literal(1),
    target: GithubAuthenticationTargetSchema,
  })
  .strict();
export const GithubAuthenticationRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: GithubAuthenticationTargetSchema,
  })
  .strict();
export const GithubAuthenticationResponseSchema = z
  .object({
    success: z.literal(true),
    target: GithubAuthenticationTargetSchema,
    authenticationChecked: z.literal(true),
    authenticated: z.boolean(),
    user: z.string().min(1).max(128).nullable(),
  })
  .strict()
  .refine(
    (value) => value.authenticated === (value.user !== null),
    'Authentication requires a verified account.'
  );
export type GithubAuthenticationTarget = z.infer<typeof GithubAuthenticationTargetSchema>;
export type GithubAuthenticationRequest = z.infer<typeof GithubAuthenticationRequestSchema>;
export type GithubAuthenticationResponse = z.infer<typeof GithubAuthenticationResponseSchema>;
