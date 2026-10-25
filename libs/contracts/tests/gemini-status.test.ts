import { expect, it } from 'vitest';
import { GeminiStatusAuthSchema, SetupCredentialStoreRequestSchema } from '../src/index.js';
const hints = {
  authenticated: false,
  authenticationChecked: false,
  method: 'api_key',
  hasApiKey: true,
  hasEnvApiKey: true,
  hasConfigFile: true,
  hasVertexConfig: false,
};
it('keeps local hints unverified', () => {
  expect(GeminiStatusAuthSchema.parse(hints)).toEqual(hints);
});
it.each([
  { authenticated: true },
  { authenticationChecked: true },
  { token: 'private' },
  { user: 'unverified' },
  { error: 'private-command-output' },
])('rejects invented proof or private metadata (%#)', (extra) => {
  expect(GeminiStatusAuthSchema.safeParse({ ...hints, ...extra }).success).toBe(false);
});
it('accepts bounded opaque Google credentials without inventing prefix validation or authentication', () => {
  const target = {
    kind: 'application-credential',
    provider: 'google',
    instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
    workingDirectory: '/app',
    credentialsPath: '/data/credentials.json',
  };
  expect(
    SetupCredentialStoreRequestSchema.parse({
      confirmed: true,
      target,
      apiKey: 'opaque-google-fixture-123456',
    }).target.provider
  ).toBe('google');
  for (const apiKey of ['short', 'masked...google-value-123456', 'google-key-with\nnewline'])
    expect(
      SetupCredentialStoreRequestSchema.safeParse({ confirmed: true, target, apiKey }).success
    ).toBe(false);
});
