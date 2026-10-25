import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
const request = vi.fn();
const status = {
  success: true,
  installed: true,
  connected: true,
  version: 'fixture',
  path: '/fixture/gemini',
  auth: {
    authenticated: false,
    authenticationChecked: false,
    method: 'api_key',
    hasApiKey: true,
    hasEnvApiKey: true,
    hasConfigFile: true,
    hasVertexConfig: false,
  },
  installCommand: 'npm install -g @google/gemini-cli@0.65.0',
  loginCommand: 'gemini',
};
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());
it('uses one passive GET without starting authentication', async () => {
  request.mockResolvedValue({ ok: true, status: 200, json: async () => status });
  expect(await new HttpApiClient().setup.getGeminiStatus()).toEqual(status);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toContain('/api/setup/gemini-status');
  expect(request.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
});
it.each([
  { authenticated: true },
  { authenticationChecked: true },
  { token: 'private' },
  { user: 'unverified' },
  { error: 'private-command-output' },
])('rejects old/private authentication claims (%#)', async (extra) => {
  request.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ...status, auth: { ...status.auth, ...extra } }),
  });
  await expect(new HttpApiClient().setup.getGeminiStatus()).rejects.toThrow(
    'Gemini status protocol is unavailable.'
  );
});
it('uses native confirmation for Google-key storage without putting the key in the preview or confirmation', async () => {
  const target = {
    kind: 'application-credential',
    provider: 'google',
    instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
    workingDirectory: '/app',
    credentialsPath: '/data/credentials.json',
  };
  const preview = { success: true, protocolVersion: 1, target };
  const result = {
    success: true,
    operation: 'store',
    configured: true,
    storage: 'managed-credentials',
    target,
  };
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  request
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply(result));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    const apiKey = 'opaque-google-client-fixture-123456';
    expect(await new HttpApiClient().setup.storeApiKey('google', apiKey)).toEqual(result);
    expect(confirm.mock.calls[0][0]).not.toContain(apiKey);
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ confirmed: true, target, apiKey });
  } finally {
    confirm.mockRestore();
  }
});
