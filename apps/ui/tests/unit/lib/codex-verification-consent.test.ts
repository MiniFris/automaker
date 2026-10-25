import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyCodexWithConsent } from '@/lib/codex-verification-consent';
const api = vi.hoisted(() => ({ getCodexVerificationTarget: vi.fn(), verifyCodexAuth: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ setup: api }) }));
const target = {
  kind: 'host-codex-verification',
  provider: 'codex',
  authMethod: 'api_key',
  credentialKind: 'api-key',
  endpoint: 'https://api.openai.com/v1/responses',
  model: 'gpt-5.2-codex',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
beforeEach(() => {
  api.getCodexVerificationTarget.mockResolvedValue({ target, protocolVersion: 1, success: true });
});
afterEach(() => vi.restoreAllMocks());
it('does not verify on cancel and never includes the unsaved key in the confirmation text', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(await verifyCodexWithConsent('api_key', 'private-api-key')).toBeUndefined();
  expect(api.verifyCodexAuth).not.toHaveBeenCalled();
  const message = confirm.mock.calls[0][0]!;
  for (const value of [
    target.endpoint,
    target.model,
    target.workingDirectory,
    target.instanceId,
    'charges',
  ])
    expect(message).toContain(value);
  expect(message).not.toContain('private-api-key');
});
it('only sends the original inspected target after explicit consent', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await verifyCodexWithConsent('api_key', 'private-api-key');
  expect(api.verifyCodexAuth).toHaveBeenCalledWith({
    confirmed: true,
    target,
    apiKey: 'private-api-key',
  });
});
it('does not ask for consent or verify if read-only inspection fails', async () => {
  api.getCodexVerificationTarget.mockRejectedValue(new Error('offline'));
  const confirm = vi.spyOn(window, 'confirm');
  await expect(verifyCodexWithConsent('api_key')).rejects.toThrow('offline');
  expect(confirm).not.toHaveBeenCalled();
  expect(api.verifyCodexAuth).not.toHaveBeenCalled();
});
