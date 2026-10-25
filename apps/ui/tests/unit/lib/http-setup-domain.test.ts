import { afterEach, expect, it, vi } from 'vitest';
import {
  createSetupClient,
  type SetupTransport,
  type SetupHostPort,
} from '@/lib/http-domains/setup';

const target = {
  kind: 'application-credential',
  provider: 'openai',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
  credentialsPath: '/data/credentials.json',
};
function fixture(approved = true, owned = target) {
  const get = vi.fn().mockResolvedValue({ success: true, protocolVersion: 1, target: owned });
  const post = vi.fn().mockResolvedValue({
    success: true,
    target: owned,
    operation: 'store',
    configured: true,
    storage: 'managed-credentials',
  });
  const unsubscribe = vi.fn(),
    subscribe = vi.fn(() => unsubscribe);
  const transport = {
    get,
    post,
    httpDelete: vi.fn(),
    subscribeToEvent: subscribe,
  } as unknown as SetupTransport;
  const host: SetupHostPort = {
    confirm: vi.fn(() => approved),
    translate: (source, values) => (values ? `${source}\n${JSON.stringify(values)}` : source),
  };
  return { api: createSetupClient(transport, host), get, post, host, subscribe, unsubscribe };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('uses only supplied IO/presentation ports and keeps event ownership with the transport', async () => {
  const fetch = vi.fn(() => {
    throw new Error('Unexpected fetch');
  });
  const websocket = vi.fn(() => {
    throw new Error('Unexpected socket');
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('WebSocket', websocket);
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('Unexpected DOM consent');
  });
  const f = fixture(false),
    callback = vi.fn();
  expect(f.get).not.toHaveBeenCalled();
  expect(f.subscribe).not.toHaveBeenCalled();
  expect(await f.api.deleteApiKey('openai')).toEqual({
    success: false,
    error: 'Credential change cancelled',
  });
  expect(f.host.confirm).toHaveBeenCalledOnce();
  expect(f.post).not.toHaveBeenCalled();
  const remove = f.api.onAuthProgress(callback);
  expect(f.subscribe).toHaveBeenCalledExactlyOnceWith('agent:stream', callback);
  remove();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(websocket).not.toHaveBeenCalled();
});

it('keeps separate setup clients bound to their own targets and consent host', async () => {
  const second = {
    ...target,
    instanceId: '62f89322-63ec-40f7-90b1-ef76c55a47ee',
    workingDirectory: '/second',
    credentialsPath: '/second-data/credentials.json',
  };
  const first = fixture(false),
    other = fixture(true, second),
    secret = 'sk-native-private-client-123456';
  expect((await first.api.storeApiKey('openai', secret)).success).toBe(false);
  expect((await other.api.storeApiKey('openai', secret)).success).toBe(true);
  expect(first.post).not.toHaveBeenCalled();
  expect(other.get).toHaveBeenCalledTimes(2);
  expect(other.post).toHaveBeenCalledExactlyOnceWith('/api/setup/store-api-key', {
    confirmed: true,
    target: second,
    apiKey: secret,
  });
  const confirmation = vi.mocked(other.host.confirm).mock.calls[0][0];
  expect(confirmation).toContain(second.workingDirectory);
  expect(confirmation).not.toContain(secret);
});

it('re-inspects the approved target through the transport before sending any credential mutation', async () => {
  const f = fixture();
  f.get.mockResolvedValueOnce({ success: true, protocolVersion: 1, target }).mockResolvedValueOnce({
    success: true,
    protocolVersion: 1,
    target: { ...target, workingDirectory: '/changed' },
  });
  await expect(f.api.storeApiKey('openai', 'sk-native-private-client-123456')).rejects.toThrow(
    'Credential target changed'
  );
  expect(f.host.confirm).toHaveBeenCalledOnce();
  expect(f.post).not.toHaveBeenCalled();
});
