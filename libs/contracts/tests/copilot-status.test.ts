import { expect, it } from 'vitest';
import { CopilotStatusAuthSchema } from '../src/index.js';

const hints = {
  authenticated: false,
  authenticationChecked: false,
  method: 'oauth',
  hasEnvToken: true,
  hasConfigFile: true,
};

it('keeps local hints separate from authentication', () => {
  expect(CopilotStatusAuthSchema.parse(hints)).toEqual(hints);
});
it.each([
  { authenticated: true },
  { authenticationChecked: true },
  { login: 'unverified-user' },
  { token: 'private-fixture' },
  { error: 'private command output' },
])('rejects invented authentication, identity and secrets (%#)', (extra) => {
  expect(CopilotStatusAuthSchema.safeParse({ ...hints, ...extra }).success).toBe(false);
});
