import { expect, it } from 'vitest';
import { MODEL_TIMEOUT_PROVIDERS } from '@automaker/types';
import { ModelTimeoutProviderSchema } from '../src/domains/settings.js';
import { IdeaPromptCategoryParameterSchema } from '../src/domains/ideation.js';
import {
  ProviderRefreshQuerySchema,
  SetupQueryValueSchema,
  VerificationAuthMethodSchema,
  CursorPermissionsScopeSchema,
  CursorPermissionProfileIdSchema,
} from '../src/domains/setup-query.js';

it('preserves Express simple query values without coercion or duplicate-key narrowing', () => {
  for (const schema of [SetupQueryValueSchema, ProviderRefreshQuerySchema]) {
    for (const value of [undefined, '', 'TRUE', 'arbitrary', ['true', 'true']]) {
      expect(schema.parse(value)).toEqual(value);
    }
    expect(schema.safeParse({ nested: 'true' }).success).toBe(false);
    expect(schema.safeParse(true).success).toBe(false);
  }
  expect(VerificationAuthMethodSchema.options).toEqual(['cli', 'api_key']);
  expect(CursorPermissionsScopeSchema.options).toEqual(['global', 'project']);
  expect(CursorPermissionProfileIdSchema.options).toEqual(['strict', 'development']);
  expect(VerificationAuthMethodSchema.safeParse(['cli', 'cli']).success).toBe(false);
  expect(IdeaPromptCategoryParameterSchema.parse('unknown-opaque-category')).toBe(
    'unknown-opaque-category'
  );
});

it('derives model timeout provider membership from its canonical types catalog', () => {
  expect(ModelTimeoutProviderSchema.options).toEqual(MODEL_TIMEOUT_PROVIDERS);
  for (const value of MODEL_TIMEOUT_PROVIDERS)
    expect(ModelTimeoutProviderSchema.parse(value)).toBe(value);
  expect(ModelTimeoutProviderSchema.safeParse('unknown-provider').success).toBe(false);
});

it('does not impose a password policy before conditional terminal authentication', async () => {
  const { TerminalAuthenticationSchema } = await import('../src/domains/terminal.js');
  for (const value of [
    undefined,
    null,
    [],
    {},
    { password: 4 },
    { password: null },
    { password: [] },
    { password: 'fixture', ignored: true },
  ])
    expect(TerminalAuthenticationSchema.parse(value)).toEqual(value);
});
