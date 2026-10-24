import { expect, it, vi } from 'vitest';
import { CodexVerificationService } from '../../../src/modules/providers/codex-verification.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
import { SetupCredentialCache } from '../../../src/modules/providers/setup-credential-cache.service.js';

const key = 'sk-offline-fixture-api-key-123456';
function fixture(environment: NodeJS.ProcessEnv = {}) {
  const runtime = { run: vi.fn().mockResolvedValue('verified') };
  const credentials = { read: vi.fn().mockResolvedValue({ kind: 'api-key' }) };
  const keys = new SetupCredentialCache();
  const settings = {
    getGlobalSettings: vi
      .fn()
      .mockResolvedValue({ providerModelTimeouts: { codex: { connectionTestTimeoutMs: 10000 } } }),
    getCredentials: vi.fn().mockResolvedValue({ apiKeys: { openai: '' } }),
  };
  const service = new CodexVerificationService(
    runtime,
    credentials,
    ProviderConnectionRepository.forWorkingDirectory('/backend'),
    Object.freeze({ ...environment }),
    keys,
    settings as never
  );
  const request = async (method: 'cli' | 'api_key' = 'api_key') =>
    ({ confirmed: true, target: (await service.target(method)).target }) as const;
  return { service, request, runtime, credentials, keys, settings };
}
it('previews API mode without reading secrets or CLI, and CLI mode with token-free metadata', async () => {
  const { service, credentials, runtime, settings } = fixture({ CODEX_HOME: '/owned/codex' });
  expect(await service.target('api_key')).toMatchObject({
    protocolVersion: 1,
    target: { endpoint: 'https://api.openai.com/v1/responses', credentialKind: 'api-key' },
  });
  expect(credentials.read).not.toHaveBeenCalled();
  credentials.read.mockResolvedValue({ kind: 'chatgpt' });
  expect(await service.target('cli')).toMatchObject({
    target: {
      endpoint: 'https://chatgpt.com/backend-api/codex/responses',
      credentialDirectory: '/owned/codex',
      credentialKind: 'chatgpt',
    },
  });
  expect(credentials.read.mock.calls[0][0]).toBe(false);
  expect(runtime.run).not.toHaveBeenCalled();
  expect(settings.getCredentials).not.toHaveBeenCalled();
});
it('uses an unsaved key only for this query without environment/cache/persistence effects', async () => {
  const before = { ...process.env };
  const { service, request, runtime, settings, keys } = fixture({ OPENAI_API_KEY: 'old' });
  const result = await service.verify({ ...(await request()), apiKey: key }, 'client');
  expect(result.authenticated).toBe(true);
  expect(runtime.run.mock.calls[0][0]).toMatchObject({
    authMethod: 'api_key',
    apiKey: key,
    endpoint: 'https://api.openai.com/v1/responses',
  });
  expect(settings.getCredentials).not.toHaveBeenCalled();
  expect(keys.get('openai')).toBeUndefined();
  expect(process.env).toEqual(before);
  expect(JSON.stringify(result)).not.toContain(key);
});
it.each(['cache', 'managed', 'environment'] as const)(
  'uses the %s key without a global override',
  async (source) => {
    const { service, request, runtime, settings, keys } = fixture(
      source === 'environment' ? { OPENAI_API_KEY: key } : {}
    );
    if (source === 'cache') keys.set('openai', key);
    if (source === 'managed')
      settings.getCredentials.mockResolvedValue({ apiKeys: { openai: key } });
    expect((await service.verify(await request(), 'client')).authenticated).toBe(true);
    expect(runtime.run.mock.calls[0][0].apiKey).toBe(key);
  }
);
it('honors bootstrap deletion and rejects invalid keys before HTTP execution', async () => {
  const { service, request, runtime, keys } = fixture({ OPENAI_API_KEY: key });
  keys.setEnvironmentConfigured('OPENAI_API_KEY', false);
  expect((await service.verify(await request(), 'client')).authenticated).toBe(false);
  expect(
    (await service.verify({ ...(await request()), apiKey: 'invalid' }, 'client')).authenticated
  ).toBe(false);
  expect(runtime.run).not.toHaveBeenCalled();
});
it.each(['instanceId', 'workingDirectory', 'endpoint'] as const)(
  'rejects stale %s before a model query',
  async (field) => {
    const { service, request, runtime } = fixture();
    const input = await request();
    const target = {
      ...input.target,
      [field]:
        field === 'instanceId'
          ? '62f89322-63ec-40f7-90b1-ef76c55a47ee'
          : field === 'endpoint'
            ? 'https://other.test/'
            : '/other',
    };
    await expect(service.verify({ ...input, target, apiKey: key }, 'client')).rejects.toMatchObject(
      { statusCode: 409 }
    );
    expect(runtime.run).not.toHaveBeenCalled();
  }
);
it('does not silently change the CLI credential kind or accept supplied keys in CLI mode', async () => {
  const { service, request, runtime, credentials } = fixture();
  const input = await request('cli');
  await expect(service.verify({ ...input, apiKey: key }, 'client')).rejects.toMatchObject({
    statusCode: 400,
  });
  credentials.read.mockResolvedValue({ kind: 'chatgpt' });
  await expect(service.verify(input, 'client')).rejects.toMatchObject({ statusCode: 409 });
  expect(runtime.run).not.toHaveBeenCalled();
});
it('does not run a model query if CLI metadata detects no credentials', async () => {
  const { service, request, credentials, runtime } = fixture();
  credentials.read.mockResolvedValue({ kind: 'not-detected' });
  expect((await service.verify(await request('cli'), 'client')).authenticated).toBe(false);
  expect(runtime.run).not.toHaveBeenCalled();
});
it('rejects a stale CLI profile before credential refresh or query', async () => {
  const { service, request, credentials, runtime } = fixture();
  const input = await request('cli');
  await expect(
    service.verify(
      {
        ...input,
        target: { ...input.target, credentialDirectory: '/other/.codex' },
      },
      'client'
    )
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(credentials.read.mock.calls.every(([includeToken]) => includeToken === false)).toBe(true);
  expect(runtime.run).not.toHaveBeenCalled();
});
it.each([
  'https://private:secret@example.test',
  'https://example.test?secret=key',
  'file:///private',
])('rejects unsafe endpoint metadata: %s', async (base) => {
  await expect(fixture({ OPENAI_BASE_URL: base }).service.target('api_key')).rejects.toThrow(
    'Codex endpoint'
  );
});
it('does not treat billing/rate-limit/partial failure outcomes as authentication proof', async () => {
  const { service, request, runtime } = fixture();
  for (const outcome of ['billing', 'rate-limit', 'no-response']) {
    runtime.run.mockResolvedValue(outcome);
    expect(await service.verify({ ...(await request()), apiKey: key }, 'client')).toMatchObject({
      authenticated: false,
      verification: 'unverified',
    });
  }
});
it('enforces per-client attempts without sharing a process-global limiter', async () => {
  const first = fixture();
  for (let index = 0; index < 5; index++)
    await first.service.verify({ ...(await first.request()), apiKey: key }, 'client');
  await expect(
    first.service.verify({ ...(await first.request()), apiKey: key }, 'client')
  ).rejects.toMatchObject({ status: 429 });
  const second = fixture();
  expect(
    (await second.service.verify({ ...(await second.request()), apiKey: key }, 'client'))
      .authenticated
  ).toBe(true);
});
it('bounds concurrency, serializes CLI probes and aborts/drains accepted work at shutdown', async () => {
  const { service, request, runtime } = fixture();
  const input = await request('cli');
  let finish!: () => void;
  runtime.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve('verified');
      })
  );
  const pending = service.verify(input, 'client');
  await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
  await expect(service.verify(input, 'other-client')).rejects.toMatchObject({ statusCode: 503 });
  const closing = service.beforeApplicationShutdown();
  expect(runtime.run.mock.calls[0][0].controller.signal.aborted).toBe(true);
  await expect(service.target('api_key')).rejects.toMatchObject({ statusCode: 503 });
  finish();
  expect((await pending).authenticated).toBe(false);
  await closing;
});
it('honors the saved deadline and does not report a late terminal success', async () => {
  const { service, request, runtime, settings } = fixture();
  settings.getGlobalSettings.mockResolvedValue({
    providerModelTimeouts: { codex: { connectionTestTimeoutMs: 20 } },
  });
  runtime.run.mockImplementation(
    ({ controller }) =>
      new Promise((resolve) => {
        controller.signal.addEventListener('abort', () => resolve('verified'), { once: true });
      })
  );
  expect(
    (await service.verify({ ...(await request()), apiKey: key }, 'client')).authenticated
  ).toBe(false);
});
