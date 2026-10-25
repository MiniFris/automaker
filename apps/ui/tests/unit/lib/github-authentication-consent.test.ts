import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyGithubWithConsent } from '@/lib/github-authentication-consent';
const api = vi.hoisted(() => ({
  getGithubAuthenticationTarget: vi.fn(),
  verifyGithubAuth: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ setup: api }) }));
const target = {
  kind: 'host-github-authentication',
  provider: 'github',
  hostname: 'github.com',
  cliPath: '/owned/gh',
  workingDirectory: '/backend',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
};
beforeEach(() => {
  api.getGithubAuthenticationTarget.mockResolvedValue({
    success: true,
    protocolVersion: 1,
    target,
  });
});
afterEach(() => vi.restoreAllMocks());
it('does not authenticate on cancel and displays the backend/host/CLI target', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(await verifyGithubWithConsent()).toBeUndefined();
  expect(api.verifyGithubAuth).not.toHaveBeenCalled();
  for (const text of [target.hostname, target.cliPath, target.workingDirectory, target.instanceId])
    expect(confirm.mock.calls[0][0]).toContain(text);
});
it('only sends the inspected target after explicit confirmation', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await verifyGithubWithConsent();
  expect(api.verifyGithubAuth).toHaveBeenCalledWith({ confirmed: true, target });
});
it('does not ask for approval when inspection fails', async () => {
  api.getGithubAuthenticationTarget.mockRejectedValue(new Error('offline'));
  const confirm = vi.spyOn(window, 'confirm');
  await expect(verifyGithubWithConsent()).rejects.toThrow('offline');
  expect(confirm).not.toHaveBeenCalled();
  expect(api.verifyGithubAuth).not.toHaveBeenCalled();
});
