import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
const request = vi.fn();
const target = {
  kind: 'application-credential',
  provider: 'openai',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
  credentialsPath: '/data/credentials.json',
};
const preview = { success: true, protocolVersion: 1, target };
const result = {
  success: true,
  target,
  operation: 'store',
  configured: true,
  storage: 'managed-credentials',
};
const reply = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => {
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('inspects, confirms and preflights the original target before sending an unsaved secret', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  request
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply(result));
  const apiKey = 'sk-native-private-client-123456';
  expect(await new HttpApiClient().setup.storeApiKey('openai', apiKey)).toEqual(result);
  expect(request).toHaveBeenCalledTimes(3);
  for (const text of [
    target.workingDirectory,
    target.credentialsPath,
    target.instanceId,
    target.provider,
  ])
    expect(confirm.mock.calls[0][0]).toContain(text);
  expect(confirm.mock.calls[0][0]).not.toContain(apiKey);
  expect(request.mock.calls[2][0]).toContain('/api/setup/store-api-key');
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ confirmed: true, target, apiKey });
});
it('cancels without POST or fake success', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  request.mockResolvedValue(reply(preview));
  expect((await new HttpApiClient().setup.deleteApiKey('openai')).success).toBe(false);
  expect(request).toHaveBeenCalledOnce();
});
it.each([
  reply({}, 404),
  reply({ success: true, target }),
  reply({ ...preview, protocolVersion: 0 }),
])('does not POST to an old backend (%#)', async (body) => {
  const confirm = vi.spyOn(window, 'confirm');
  request.mockResolvedValue(body);
  await expect(new HttpApiClient().setup.deleteApiKey('openai')).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});
it.each(['instanceId', 'workingDirectory', 'credentialsPath'] as const)(
  'does not replace approved %s after consent',
  async (field) => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    request.mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(
      reply({
        ...preview,
        target: {
          ...target,
          [field]: field === 'instanceId' ? '62f89322-63ec-40f7-90b1-ef76c55a47ee' : '/other',
        },
      })
    );
    await expect(new HttpApiClient().setup.deleteApiKey('openai')).rejects.toThrow(
      'target changed'
    );
    expect(request).toHaveBeenCalledTimes(2);
  }
);
it('deletes using confirmed native DTO and checks the result identity', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  request
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply({ ...result, operation: 'delete', configured: false }));
  await new HttpApiClient().setup.deleteApiKey('openai');
  expect(request.mock.calls[2][0]).toContain('/api/setup/delete-api-key');
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ confirmed: true, target });
});
