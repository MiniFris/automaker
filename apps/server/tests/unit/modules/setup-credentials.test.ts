import { expect, it, vi } from 'vitest';
import { SetupCredentialsService } from '../../../src/modules/providers/setup-credentials.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';
function fixture() {
  const credentials = { change: vi.fn().mockResolvedValue(undefined) };
  const settings = { getDataDirectory: () => '/data' };
  const service = new SetupCredentialsService(
    credentials as never,
    settings as never,
    ProviderConnectionRepository.forWorkingDirectory('/backend')
  );
  const target = service.target('openai').target;
  return { service, credentials, target };
}
it('previews storage identity without reading secrets or performing a write', () => {
  const { service, credentials } = fixture();
  expect(service.target('anthropic')).toMatchObject({
    protocolVersion: 1,
    target: {
      credentialsPath: '/data/credentials.json',
      workingDirectory: '/backend',
      provider: 'anthropic',
    },
  });
  expect(credentials.change).not.toHaveBeenCalled();
  expect(() => service.target('__proto__')).toThrow('Unsupported');
});
it.each([
  {},
  { provider: 'openai', apiKey: 'sk-private' },
  { confirmed: false },
  { confirmed: true, extra: true },
])('rejects legacy or unconfirmed writes (%#)', async (input) => {
  const { service, credentials } = fixture();
  await expect(service.change('store', input, 'client')).rejects.toMatchObject({ statusCode: 400 });
  expect(credentials.change).not.toHaveBeenCalled();
});
it.each(['instanceId', 'workingDirectory', 'credentialsPath'] as const)(
  'rejects a stale %s before persistence',
  async (field) => {
    const { service, credentials, target } = fixture();
    const changed = {
      ...target,
      [field]: field === 'instanceId' ? '62f89322-63ec-40f7-90b1-ef76c55a47ee' : '/other',
    };
    await expect(
      service.change('delete', { confirmed: true, target: changed }, 'client')
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(credentials.change).not.toHaveBeenCalled();
  }
);
it('stores and deletes only through the application writer and never echoes the secret', async () => {
  const { service, credentials, target } = fixture();
  const apiKey = 'sk-native-fixture-private-123456';
  const result = await service.change('store', { confirmed: true, target, apiKey }, 'client');
  expect(result).toMatchObject({ success: true, operation: 'store', configured: true, target });
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(credentials.change).toHaveBeenCalledWith('openai', apiKey);
  expect(await service.change('delete', { confirmed: true, target }, 'client')).toMatchObject({
    operation: 'delete',
    configured: false,
  });
  expect(credentials.change).toHaveBeenLastCalledWith('openai', null);
});
it('does not report persistence failure as success or expose private diagnostics', async () => {
  const { service, credentials, target } = fixture();
  credentials.change.mockRejectedValue(new Error('private-key raw path'));
  await expect(service.change('delete', { confirmed: true, target }, 'client')).rejects.toThrow(
    'Application credentials could not be updated.'
  );
});
it('limits attempts per application', async () => {
  const { service, target } = fixture();
  for (let index = 0; index < 10; index++)
    await service.change('delete', { confirmed: true, target }, 'client');
  await expect(
    service.change('delete', { confirmed: true, target }, 'client')
  ).rejects.toMatchObject({ status: 429 });
  const other = fixture();
  expect(
    (await other.service.change('delete', { confirmed: true, target: other.target }, 'client'))
      .success
  ).toBe(true);
});
it('bounds pending mutations and drains accepted writes at shutdown', async () => {
  const { service, credentials, target } = fixture();
  let finish!: () => void;
  const hold = new Promise<void>((resolve) => {
    finish = resolve;
  });
  credentials.change.mockReturnValue(hold);
  const pending = Array.from({ length: 16 }, (_, index) =>
    service.change('delete', { confirmed: true, target }, `client-${index}`)
  );
  await vi.waitFor(() => expect(credentials.change).toHaveBeenCalledTimes(16));
  await expect(
    service.change('delete', { confirmed: true, target }, 'extra')
  ).rejects.toMatchObject({ statusCode: 503 });
  const closing = service.beforeApplicationShutdown();
  expect(service.beforeApplicationShutdown()).toBe(closing);
  expect(() => service.target('openai')).toThrow('shutting down');
  finish();
  await Promise.all(pending);
  await closing;
});
