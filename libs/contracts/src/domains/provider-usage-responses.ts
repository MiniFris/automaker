import { z } from 'zod';

const UsageError = z.looseObject({ error: z.string(), message: z.string().optional() });
export const ClaudeUsageResponseSchema = z.union([
  z.looseObject({
    sessionTokensUsed: z.number(),
    sessionLimit: z.number(),
    sessionPercentage: z.number(),
    sessionResetTime: z.string(),
    sessionResetText: z.string(),
    weeklyTokensUsed: z.number(),
    weeklyLimit: z.number(),
    weeklyPercentage: z.number(),
    weeklyResetTime: z.string(),
    weeklyResetText: z.string(),
    sonnetWeeklyTokensUsed: z.number(),
    sonnetWeeklyPercentage: z.number(),
    sonnetResetText: z.string(),
    costUsed: z.number().nullable(),
    costLimit: z.number().nullable(),
    costCurrency: z.string().nullable(),
    lastUpdated: z.string(),
    userTimezone: z.string(),
  }),
  UsageError,
]);
const CodexWindow = z.looseObject({
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
  usedPercent: z.number(),
  windowDurationMins: z.number(),
  resetsAt: z.number(),
});
export const CodexUsageResponseSchema = z.union([
  z.looseObject({
    rateLimits: z
      .looseObject({
        primary: CodexWindow.optional(),
        secondary: CodexWindow.optional(),
        planType: z.string().optional(),
      })
      .nullable(),
    lastUpdated: z.string(),
  }),
  UsageError,
]);
const ProviderFailure = z.looseObject({
  success: z.literal(false),
  error: z.string(),
  message: z.string().optional(),
});
/** Cache admission guarantees an array, but does not normalize historical model records. */
export const CodexModelsResponseSchema = z.union([
  z.looseObject({ success: z.literal(true), models: z.array(z.unknown()), cachedAt: z.number() }),
  ProviderFailure,
]);
const GeminiTier = z.looseObject({
  usedPercent: z.number(),
  remainingPercent: z.number(),
  resetText: z.string().optional(),
  resetTime: z.string().optional(),
});
export const GeminiUsageResponseSchema = z.looseObject({
  authenticated: z.boolean(),
  authMethod: z.string(),
  usedPercent: z.number(),
  remainingPercent: z.number(),
  resetText: z.string().optional(),
  resetTime: z.string().optional(),
  constrainedModel: z.string().optional(),
  flashQuota: GeminiTier.optional(),
  proQuota: GeminiTier.optional(),
  quotaBuckets: z
    .array(
      z.looseObject({ modelId: z.string(), remainingFraction: z.number(), resetTime: z.string() })
    )
    .optional(),
  lastUpdated: z.string(),
  error: z.string().optional(),
});
export const GeminiStatusResponseSchema = z.union([
  z.looseObject({
    success: z.literal(true),
    installed: z.boolean(),
    version: z.string().nullable(),
    path: z.string().nullable(),
    authenticated: z.boolean(),
    authenticationChecked: z.boolean(),
    authMethod: z.string(),
    hasCredentialsFile: z.boolean(),
  }),
  ProviderFailure,
]);
export const ZaiConfigureResponseSchema = z.union([
  z.looseObject({ success: z.boolean(), message: z.string(), isAvailable: z.boolean() }),
  UsageError,
]);
export const ZaiVerifyResponseSchema = z.looseObject({
  success: z.boolean(),
  authenticated: z.boolean(),
  message: z.string().optional(),
  error: z.string().optional(),
});
const ZaiLimit = z.looseObject({
  limitType: z.string(),
  limit: z.number(),
  used: z.number(),
  remaining: z.number(),
  usedPercent: z.number(),
  nextResetTime: z.number(),
});
export const ZaiUsageResponseSchema = z.union([
  z.looseObject({
    quotaLimits: z
      .looseObject({ tokens: ZaiLimit.optional(), mcp: ZaiLimit.optional(), planType: z.string() })
      .nullable(),
    usageDetails: z
      .array(z.looseObject({ modelId: z.string(), used: z.number(), limit: z.number() }))
      .optional(),
    lastUpdated: z.string(),
  }),
  UsageError,
]);
export const ZaiStatusResponseSchema = z.looseObject({
  success: z.literal(true),
  available: z.boolean(),
  hasApiKey: z.boolean(),
  hasEnvApiKey: z.boolean(),
  message: z.string(),
});
