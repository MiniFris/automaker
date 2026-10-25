import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';

const request = vi.fn();
const status = {
  success: true,
  installed: true,
  connected: true,
  version: 'fixture',
  path: '/fixture/copilot',
  auth: {
    authenticated: false,
    authenticationChecked: false,
    method: 'oauth',
    hasEnvToken: true,
    hasConfigFile: true,
  },
  installCommand: 'npm install -g @github/copilot',
  loginCommand: 'gh auth login',
};
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());

it('fetches one passive status and never posts an authentication command', async () => {
  request.mockResolvedValue({ ok: true, status: 200, json: async () => status });
  expect(await new HttpApiClient().setup.getCopilotStatus()).toEqual(status);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toContain('/api/setup/copilot-status');
  expect(request.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
});
it.each([
  { authenticated: true },
  { authenticationChecked: true },
  { login: 'unverified' },
  { token: 'private-fixture' },
  { error: 'private command output' },
])(
  'rejects old/invalid authentication claims without leaking response contents (%#)',
  async (extra) => {
    request.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...status, auth: { ...status.auth, ...extra } }),
    });
    await expect(new HttpApiClient().setup.getCopilotStatus()).rejects.toThrow(
      'Copilot status protocol is unavailable.'
    );
  }
);
