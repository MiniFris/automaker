import { expect, it } from 'vitest';
import {
  SetupCredentialStoreRequestSchema,
  SetupCredentialDeleteRequestSchema,
  SetupCredentialMutationResponseSchema,
  SetupCredentialTargetResponseSchema,
} from '../src/index.js';
const target = {
  kind: 'application-credential',
  provider: 'openai',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
  credentialsPath: '/data/credentials.json',
};
it('requires versioned target inspection and literal consent', () => {
  expect(SetupCredentialTargetResponseSchema.safeParse({ success: true, target }).success).toBe(
    false
  );
  expect(
    SetupCredentialTargetResponseSchema.parse({ success: true, protocolVersion: 1, target }).target
  ).toEqual(target);
  expect(SetupCredentialDeleteRequestSchema.safeParse({ target }).success).toBe(false);
});
it.each([
  '',
  'sk-mask...1234567890123456789',
  'sk-newline-private\n123456789',
  'wrong-provider-value-123456',
])('rejects invalid or masked key input (%#)', (apiKey) => {
  expect(
    SetupCredentialStoreRequestSchema.safeParse({ confirmed: true, target, apiKey }).success
  ).toBe(false);
});
it('does not accept secret fields on delete or an inconsistent result', () => {
  expect(
    SetupCredentialDeleteRequestSchema.safeParse({ confirmed: true, target, apiKey: 'private' })
      .success
  ).toBe(false);
  expect(
    SetupCredentialMutationResponseSchema.safeParse({
      success: true,
      target,
      operation: 'delete',
      configured: true,
      storage: 'managed-credentials',
    }).success
  ).toBe(false);
});
