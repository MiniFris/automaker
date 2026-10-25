import { expect, it } from 'vitest';
import {
  CodexVerificationRequestSchema,
  CodexVerificationTargetResponseSchema,
  CodexVerificationResponseSchema,
} from '../src/index.js';
const target = {
  kind: 'host-codex-verification',
  provider: 'codex',
  authMethod: 'cli',
  credentialKind: 'api-key',
  credentialDirectory: '/backend/.codex',
  endpoint: 'https://api.openai.com/v1/responses',
  model: 'gpt-5.2-codex',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
};
it('requires capability metadata for a billable verification preview', () => {
  expect(CodexVerificationTargetResponseSchema.safeParse({ success: true, target }).success).toBe(
    false
  );
  expect(
    CodexVerificationTargetResponseSchema.parse({ success: true, protocolVersion: 1, target })
      .target
  ).toEqual(target);
});
it.each([
  {},
  { confirmed: false, target },
  { confirmed: true, target, authMethod: 'cli' },
  { confirmed: true, target, apiKey: 'private' },
  { confirmed: true, target: { ...target, model: 'other' } },
  { confirmed: true, target: { ...target, provider: 'claude' } },
  { confirmed: true, target: { ...target, authMethod: 'api_key' }, apiKey: 'private\nheader' },
])('rejects implicit or ambiguous verification requests: %s', (input) => {
  expect(CodexVerificationRequestSchema.safeParse(input).success).toBe(false);
});
it('requires successful evidence and auth method to match the target', () => {
  const response = {
    success: true,
    target,
    authType: 'cli',
    authenticated: true,
    verification: 'verified',
  };
  expect(CodexVerificationResponseSchema.parse(response)).toEqual(response);
  expect(
    CodexVerificationResponseSchema.safeParse({ ...response, verification: 'unverified' }).success
  ).toBe(false);
  expect(
    CodexVerificationResponseSchema.safeParse({ ...response, authType: 'api_key' }).success
  ).toBe(false);
});
