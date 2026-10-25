import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
const request = vi.fn();
const status = {
  success: true,
  installed: true,
  connected: true,
  version: 'fixture',
  path: '/fixture/cursor-agent',
  auth: {
    authenticated: false,
    authenticationChecked: false,
    scope: 'host',
    method: 'api_key',
    hasEnvApiKey: true,
    hasCredentialsFile: true,
  },
  installCommand: 'curl https://cursor.com/install -fsS | bash',
  loginCommand: 'cursor-agent login',
};
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());
it('uses only the passive status GET', async () => {
  request.mockResolvedValue({ ok: true, status: 200, json: async () => status });
  expect(await new HttpApiClient().setup.getCursorStatus()).toEqual(status);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toContain('/api/setup/cursor-status');
  expect(request.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
});
it.each([
  { authenticated: true },
  { authenticationChecked: true },
  { method: 'login' },
  { token: 'private' },
  { user: 'private' },
  { scope: 'wsl' },
  { error: 'private-CLI-output' },
])('rejects old, unverified or private Cursor auth claims (%#)', async (extra) => {
  request.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ...status, auth: { ...status.auth, ...extra } }),
  });
  await expect(new HttpApiClient().setup.getCursorStatus()).rejects.toThrow(
    'Cursor status protocol is unavailable.'
  );
});
