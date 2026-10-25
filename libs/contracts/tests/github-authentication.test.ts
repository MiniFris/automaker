import { expect, it } from 'vitest';
import {
  GithubAuthenticationRequestSchema,
  GithubAuthenticationResponseSchema,
  GithubAuthenticationTargetResponseSchema,
} from '../src/index.js';
const target = {
  kind: 'host-github-authentication',
  provider: 'github',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
  cliPath: '/owned/gh',
  hostname: 'github.com',
};
it('requires an explicit capability version in the preview', () => {
  expect(
    GithubAuthenticationTargetResponseSchema.safeParse({ success: true, target }).success
  ).toBe(false);
  expect(
    GithubAuthenticationTargetResponseSchema.parse({ success: true, protocolVersion: 1, target })
      .target
  ).toEqual(target);
});
it.each([
  {},
  { confirmed: false, target },
  { confirmed: true, target, token: 'private' },
  { confirmed: true, target: { ...target, provider: 'claude' } },
  { confirmed: true, target: { ...target, hostname: 'host/private?secret' } },
])('rejects ambiguous confirmation (%#)', (input) => {
  expect(GithubAuthenticationRequestSchema.safeParse(input).success).toBe(false);
});
it('requires account evidence to agree with the authentication result', () => {
  const response = {
    success: true,
    target,
    authenticationChecked: true,
    authenticated: true,
    user: 'fixture',
  };
  expect(GithubAuthenticationResponseSchema.parse(response)).toEqual(response);
  expect(GithubAuthenticationResponseSchema.safeParse({ ...response, user: null }).success).toBe(
    false
  );
  expect(
    GithubAuthenticationResponseSchema.safeParse({ ...response, authenticationChecked: false })
      .success
  ).toBe(false);
});
