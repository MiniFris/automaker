import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  PaginationQuerySchema,
  ProjectPathSchema,
  type ErrorEnvelope,
} from '../src/index.js';

describe('shared transport contracts', () => {
  it('preserves the legacy error envelope and allows additive error codes', () => {
    const parsed = ErrorEnvelopeSchema.parse({
      success: false,
      error: 'Not found',
      code: 'FEATURE_NOT_FOUND',
    });

    expect(parsed).toEqual({
      success: false,
      error: 'Not found',
      code: 'FEATURE_NOT_FOUND',
    });
    expectTypeOf(parsed).toEqualTypeOf<ErrorEnvelope>();
  });

  it('normalizes pagination query values and enforces a bounded limit', () => {
    expect(PaginationQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
    expect(() => PaginationQuerySchema.parse({ limit: 501 })).toThrow();
  });

  it('keeps path syntax platform-neutral for later sandbox validation', () => {
    expect(ProjectPathSchema.parse('C:\\work\\automaker')).toBe('C:\\work\\automaker');
    expect(ProjectPathSchema.parse('/work/automaker')).toBe('/work/automaker');
  });

  it('validates the stable health payload', () => {
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      }).success
    ).toBe(true);
  });
});
