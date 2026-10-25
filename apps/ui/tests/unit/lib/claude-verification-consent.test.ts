import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyClaudeWithConsent } from '@/lib/claude-verification-consent';
const api = vi.hoisted(() => ({ getClaudeVerificationTarget: vi.fn(), verifyClaudeAuth: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ setup: api }) }));
const target = {
  kind: 'host-claude-verification',
  provider: 'claude',
  authMethod: 'api_key',
  endpoint: 'https://api.anthropic.com/',
  model: 'claude-sonnet-4-6',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
beforeEach(() => {
  api.getClaudeVerificationTarget.mockResolvedValue({ target, protocolVersion: 1, success: true });
});
afterEach(() => vi.restoreAllMocks());
it('does not verify on cancel and never includes the unsaved key in the confirmation text', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(await verifyClaudeWithConsent('api_key', 'private-api-key')).toBeUndefined();
  expect(api.verifyClaudeAuth).not.toHaveBeenCalled();
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
  await verifyClaudeWithConsent('api_key', 'private-api-key');
  expect(api.verifyClaudeAuth).toHaveBeenCalledWith({
    confirmed: true,
    target,
    apiKey: 'private-api-key',
  });
});
it('does not ask for consent or verify if read-only inspection fails', async () => {
  api.getClaudeVerificationTarget.mockRejectedValue(new Error('offline'));
  const confirm = vi.spyOn(window, 'confirm');
  await expect(verifyClaudeWithConsent('api_key')).rejects.toThrow('offline');
  expect(confirm).not.toHaveBeenCalled();
  expect(api.verifyClaudeAuth).not.toHaveBeenCalled();
});
