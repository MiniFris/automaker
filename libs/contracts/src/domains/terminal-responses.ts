import { z } from 'zod';
import { GitExecutionEnvironmentSchema } from './git-responses.js';

const success = z.literal(true);
const date = z.preprocess((value) => (value instanceof Date ? value.toJSON() : value), z.string());
export const TerminalFailureResponseSchema = z.looseObject({
  success: z.literal(false),
  error: z.string(),
  details: z.string().optional(),
  code: z.string().optional(),
  errorCode: z.string().optional(),
  currentSessions: z.number().optional(),
  maxSessions: z.number().optional(),
});
const session = z.looseObject({
  id: z.string(),
  cwd: z.string(),
  shell: z.string(),
  executionEnvironment: GitExecutionEnvironmentSchema.optional(),
});
const createdSession = session.extend({ createdAt: date });
export const TerminalStatusResponseSchema = z.looseObject({
  success,
  data: z.looseObject({
    enabled: z.boolean(),
    passwordRequired: z.boolean(),
    platform: z.looseObject({
      platform: z.string(),
      isWSL: z.boolean(),
      defaultShell: z.string(),
      arch: z.string(),
    }),
  }),
});
export const TerminalAuthenticationResponseSchema = z.union([
  z.looseObject({
    success,
    data: z.union([
      z.looseObject({ authenticated: z.literal(true), passwordRequired: z.literal(false) }),
      z.looseObject({ authenticated: z.literal(true), token: z.string(), expiresIn: z.number() }),
    ]),
  }),
  TerminalFailureResponseSchema,
]);
export const TerminalMutationResponseSchema = z.union([
  z.looseObject({ success }),
  TerminalFailureResponseSchema,
]);
export const TerminalSessionsResponseSchema = z.looseObject({
  success,
  data: z.array(createdSession),
});
export const TerminalSessionResponseSchema = z.union([
  z.looseObject({ success, data: session }),
  TerminalFailureResponseSchema,
]);
export const TerminalCreatedSessionResponseSchema = z.union([
  z.looseObject({ success, data: createdSession }),
  TerminalFailureResponseSchema,
]);
export const TerminalSettingsResponseSchema = z.union([
  z.looseObject({
    success,
    data: z.looseObject({ maxSessions: z.number(), currentSessions: z.number() }),
  }),
  TerminalFailureResponseSchema,
]);
