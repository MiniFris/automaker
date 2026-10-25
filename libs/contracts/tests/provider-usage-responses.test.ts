import { expect, it } from 'vitest';
import {
  CodexUsageResponseSchema,
  CodexModelsResponseSchema,
  GeminiUsageResponseSchema,
  ZaiUsageResponseSchema,
} from '../src/domains/provider-usage-responses.js';

it('retains historical cache records and nullable usage instead of inventing model normalization', () => {
  const cached = {
    success: true,
    models: [null, 'legacy', { id: 'future', metadata: null }],
    cachedAt: 123,
    extension: ['retained'],
  };
  expect(CodexModelsResponseSchema.parse(cached)).toEqual(cached);
  expect(CodexUsageResponseSchema.parse({ rateLimits: null, lastUpdated: '' })).toEqual({
    rateLimits: null,
    lastUpdated: '',
  });
  expect(ZaiUsageResponseSchema.parse({ quotaLimits: null, lastUpdated: '' })).toEqual({
    quotaLimits: null,
    lastUpdated: '',
  });
});
it('rejects malformed nested quota/usage metadata while preserving numeric values without invented ranges', () => {
  const valid = {
    authenticated: true,
    authMethod: 'future',
    usedPercent: 110,
    remainingPercent: -10,
    lastUpdated: 'historical',
    quotaBuckets: [{ modelId: 'future', remainingFraction: 1.1, resetTime: '' }],
  };
  expect(GeminiUsageResponseSchema.parse(valid)).toEqual(valid);
  expect(
    GeminiUsageResponseSchema.safeParse({
      ...valid,
      quotaBuckets: [{ modelId: 'future', remainingFraction: 'bad', resetTime: '' }],
    }).success
  ).toBe(false);
  expect(
    CodexUsageResponseSchema.safeParse({
      rateLimits: { primary: { usedPercent: 10 } },
      lastUpdated: '',
    }).success
  ).toBe(false);
  expect(
    ZaiUsageResponseSchema.safeParse({
      quotaLimits: { planType: 'future', tokens: { used: 'bad' } },
      lastUpdated: '',
    }).success
  ).toBe(false);
});
