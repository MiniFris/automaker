import { expect, it } from 'vitest';
import {
  ClaudeVerificationRequestSchema,
  ClaudeVerificationTargetResponseSchema,
  ClaudeVerificationResponseSchema,
} from '../src/index.js';
const target = {
  kind: 'host-claude-verification',
  provider: 'claude',
  authMethod: 'cli',
  endpoint: 'https://api.anthropic.com/',
  model: 'claude-sonnet-4-6',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
};
it('requires capability metadata for a billable verification preview', () => {
  expect(ClaudeVerificationTargetResponseSchema.safeParse({ success: true, target }).success).toBe(
    false
  );
  expect(
    ClaudeVerificationTargetResponseSchema.parse({ success: true, protocolVersion: 1, target })
      .target
  ).toEqual(target);
});
it.each([
  {},
  { confirmed: false, target },
  { confirmed: true, target, authMethod: 'cli' },
  { confirmed: true, target, apiKey: 'private' },
  { confirmed: true, target: { ...target, model: 'other' } },
  { confirmed: true, target: { ...target, provider: 'codex' } },
  { confirmed: true, target: { ...target, authMethod: 'api_key' }, apiKey: 'private\nheader' },
])('rejects implicit or ambiguous verification requests: %s', (input) => {
  expect(ClaudeVerificationRequestSchema.safeParse(input).success).toBe(false);
});
it('requires successful evidence and auth method to match the target', () => {
  const response = {
    success: true,
    target,
    authType: 'cli',
    authenticated: true,
    verification: 'verified',
  };
  expect(ClaudeVerificationResponseSchema.parse(response)).toEqual(response);
  expect(
    ClaudeVerificationResponseSchema.safeParse({ ...response, verification: 'unverified' }).success
  ).toBe(false);
  expect(
    ClaudeVerificationResponseSchema.safeParse({ ...response, authType: 'api_key' }).success
  ).toBe(false);
});
