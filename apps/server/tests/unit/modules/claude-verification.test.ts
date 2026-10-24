import { expect, it, vi } from 'vitest';
import { ClaudeVerificationService } from '../../../src/modules/providers/claude-verification.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
import { SetupCredentialCache } from '../../../src/modules/providers/setup-credential-cache.service.js';

const key = 'sk-ant-private-fixture-key-123456';
function fixture(environment: NodeJS.ProcessEnv = {}) {
  const runtime = { run: vi.fn().mockResolvedValue('verified') };
  const settings = {
    getGlobalSettings: vi
      .fn()
      .mockResolvedValue({ providerModelTimeouts: { claude: { connectionTestTimeoutMs: 10000 } } }),
    getCredentials: vi.fn().mockResolvedValue({ apiKeys: { anthropic: '' } }),
  };
  const keys = new SetupCredentialCache();
  const service = new ClaudeVerificationService(
    runtime,
    ProviderConnectionRepository.forWorkingDirectory('/backend'),
    Object.freeze({ ...environment }),
    keys,
    settings as never
  );
  const request = (authMethod: 'cli' | 'api_key' = 'cli') =>
    ({ confirmed: true, target: service.target(authMethod).target }) as const;
  return { service, request, runtime, settings, keys };
}
it('previews the exact endpoint/model/method without probing credentials or launching an SDK', () => {
  const { service, runtime, settings } = fixture();
  expect(service.target('api_key')).toMatchObject({
    success: true,
    protocolVersion: 1,
    target: {
      workingDirectory: '/backend',
      endpoint: 'https://api.anthropic.com/',
      authMethod: 'api_key',
      model: 'claude-sonnet-4-6',
    },
  });
  expect(runtime.run).not.toHaveBeenCalled();
  expect(settings.getCredentials).not.toHaveBeenCalled();
  expect(() => service.target(undefined)).toThrow();
});
it('passes provided API key only to this run, clears alternate auth/routing and never mutates process.env/cache', async () => {
  const before = { ...process.env };
  const { service, request, runtime, keys, settings } = fixture({
    ANTHROPIC_API_KEY: 'bootstrap',
    ANTHROPIC_AUTH_TOKEN: 'other',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
    CLAUDE_CODE_USE_BEDROCK: '1',
    ANTHROPIC_CUSTOM_HEADERS: 'Authorization: private',
    PATH: '/owned/bin',
  });
  const result = await service.verify({ ...request('api_key'), apiKey: key }, 'client');
  expect(result.authenticated).toBe(true);
  expect(runtime.run.mock.calls[0][0]).toMatchObject({
    cwd: '/backend',
    environment: {
      PATH: '/owned/bin',
      ANTHROPIC_API_KEY: key,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      CLAUDE_CODE_USE_BEDROCK: undefined,
      ANTHROPIC_CUSTOM_HEADERS: undefined,
    },
  });
  expect(process.env).toEqual(before);
  expect(keys.get('anthropic')).toBeUndefined();
  expect(settings.getCredentials).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(key);
});
it('keeps CLI auth separate from bootstrap/cache API keys without reading stored secrets', async () => {
  const { service, request, runtime, keys, settings } = fixture({ ANTHROPIC_API_KEY: key });
  keys.set('anthropic', key);
  await service.verify(request('cli'), 'client');
  expect(runtime.run.mock.calls[0][0].environment.ANTHROPIC_API_KEY).toBeUndefined();
  expect(settings.getCredentials).not.toHaveBeenCalled();
});
it.each(['cache', 'managed', 'environment'] as const)(
  'resolves %s API credentials without global overrides',
  async (source) => {
    const { service, request, runtime, keys, settings } = fixture(
      source === 'environment' ? { ANTHROPIC_API_KEY: key } : {}
    );
    if (source === 'cache') keys.set('anthropic', key);
    if (source === 'managed')
      settings.getCredentials.mockResolvedValue({ apiKeys: { anthropic: key } });
    expect((await service.verify(request('api_key'), 'client')).authenticated).toBe(true);
    expect(runtime.run.mock.calls[0][0].environment.ANTHROPIC_API_KEY).toBe(key);
  }
);
it.each([undefined, 'bad-key'])(
  'does not launch a query for absent/invalid key: %s',
  async (apiKey) => {
    const { service, request, runtime } = fixture();
    expect(
      (await service.verify({ ...request('api_key'), ...(apiKey && { apiKey }) }, 'client'))
        .authenticated
    ).toBe(false);
    expect(runtime.run).not.toHaveBeenCalled();
  }
);
it.each(['instanceId', 'workingDirectory', 'endpoint'] as const)(
  'rejects stale %s before SDK admission',
  async (field) => {
    const { service, request, runtime } = fixture();
    const input = request();
    await expect(
      service.verify(
        {
          ...input,
          target: {
            ...input.target,
            [field]:
              field === 'instanceId'
                ? '62f89322-63ec-40f7-90b1-ef76c55a47ee'
                : field === 'endpoint'
                  ? 'https://other.test/'
                  : '/other',
          },
        },
        'client'
      )
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(runtime.run).not.toHaveBeenCalled();
  }
);
it.each([
  'https://private-user:secret@example.test',
  'https://example.test?key=private',
  'file:///secret',
])('does not expose unsafe endpoint metadata: %s', (endpoint) => {
  const { service } = fixture({ ANTHROPIC_BASE_URL: endpoint });
  expect(() => service.target('cli')).toThrow('Claude endpoint');
});
it('requires explicit consent and prevents supplied API keys in CLI mode', async () => {
  const { service, request, runtime } = fixture();
  await expect(
    service.verify({ ...request(), confirmed: false } as never, 'client')
  ).rejects.toMatchObject({ statusCode: 400 });
  await expect(service.verify({ ...request(), apiKey: key }, 'client')).rejects.toMatchObject({
    statusCode: 400,
  });
  expect(runtime.run).not.toHaveBeenCalled();
});
it('honors the application cache bootstrap-key tombstone after a legacy delete', async () => {
  const { service, request, runtime, keys } = fixture({ ANTHROPIC_API_KEY: key });
  keys.setEnvironmentConfigured('ANTHROPIC_API_KEY', false);
  expect((await service.verify(request('api_key'), 'client')).authenticated).toBe(false);
  expect(runtime.run).not.toHaveBeenCalled();
});
it('rate limits attempts per application/client rather than sharing a process-global limiter', async () => {
  const first = fixture();
  for (let index = 0; index < 5; index++) await first.service.verify(first.request(), 'client');
  await expect(first.service.verify(first.request(), 'client')).rejects.toMatchObject({
    status: 429,
  });
  const second = fixture();
  expect((await second.service.verify(second.request(), 'client')).authenticated).toBe(true);
});
it('uses the saved verification deadline and cannot accept a late verified result after abort', async () => {
  const { service, request, runtime, settings } = fixture();
  settings.getGlobalSettings.mockResolvedValue({
    providerModelTimeouts: { claude: { connectionTestTimeoutMs: 20 } },
  });
  runtime.run.mockImplementation(
    ({ controller }) =>
      new Promise((resolve) => {
        controller.signal.addEventListener('abort', () => resolve('verified'), { once: true });
      })
  );
  expect(await service.verify(request(), 'client')).toMatchObject({
    authenticated: false,
    verification: 'unverified',
    error: expect.stringContaining('timed out'),
  });
  expect(runtime.run.mock.calls[0][0].controller.signal.aborted).toBe(true);
});
it('aborts and drains in-flight probes at shutdown, blocks new admission and leaves another app usable', async () => {
  const first = fixture();
  let finish!: () => void;
  first.runtime.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve('verified');
      })
  );
  const pending = first.service.verify(first.request(), 'client');
  await vi.waitFor(() => expect(first.runtime.run).toHaveBeenCalledOnce());
  let closed = false;
  const closing = first.service.beforeApplicationShutdown().then(() => {
    closed = true;
  });
  expect(first.runtime.run.mock.calls[0][0].controller.signal.aborted).toBe(true);
  expect(() => first.service.target('cli')).toThrow();
  expect(closed).toBe(false);
  finish();
  expect((await pending).authenticated).toBe(false);
  await closing;
  const second = fixture();
  expect((await second.service.verify(second.request(), 'client')).authenticated).toBe(true);
});
it('returns only normalized errors when SDK runtime throws secrets', async () => {
  const { service, request, runtime } = fixture();
  runtime.run.mockRejectedValue(new Error(key));
  const result = await service.verify(request(), 'client');
  expect(result.authenticated).toBe(false);
  expect(JSON.stringify(result)).not.toContain(key);
});
it('bounds concurrent probes and gives reentrant shutdown callers the same drain promise', async () => {
  const { service, request, runtime } = fixture();
  let reentrant: Promise<void> | undefined;
  runtime.run.mockImplementation(
    ({ controller }) =>
      new Promise((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            reentrant = service.beforeApplicationShutdown();
            resolve('timeout');
          },
          { once: true }
        );
      })
  );
  const pending = Array.from({ length: 4 }, (_, index) =>
    service.verify(request(), `client-${index}`)
  );
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(4));
  await expect(service.verify(request(), 'extra-client')).rejects.toMatchObject({
    statusCode: 503,
  });
  const closing = service.beforeApplicationShutdown();
  expect(reentrant).toBe(closing);
  await Promise.all([...pending, closing]);
  expect(runtime.run).toHaveBeenCalledTimes(4);
});
