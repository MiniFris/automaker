import { expect, it } from 'vitest';
import {
  CredentialSlotSchema,
  HttpAuthenticationContextSchema,
  SessionCookieContextSchema,
  TerminalLogoutContextSchema,
} from '../src/domains/request-context.js';
it('requires explicit credential classification and does not accept raw credential arrays as normalized strings', () => {
  expect(CredentialSlotSchema.safeParse({ kind: 'string', value: [] }).success).toBe(false);
  expect(CredentialSlotSchema.safeParse({ kind: 'invalid', value: 'leak' }).success).toBe(false);
  expect(HttpAuthenticationContextSchema.safeParse({}).success).toBe(false);
});
it('preserves opaque historical JSON cookies while requiring selected terminal tokens to be strings', () => {
  const token = { legacy: [null, 42] };
  expect(SessionCookieContextSchema.parse({ token })).toEqual({ token });
  expect(TerminalLogoutContextSchema.parse({ token: '' })).toEqual({ token: '' });
  expect(TerminalLogoutContextSchema.safeParse({ token }).success).toBe(false);
});
