import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
import type { CliConnectionProvider } from '@automaker/contracts';

const request = vi.fn();
let client: HttpApiClient;
const target = {
  kind: 'host-application',
  provider: 'claude',
  workingDirectory: '/backend',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
} as const;
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('fetch', request);
  client = new HttpApiClient();
});
afterEach(() => vi.unstubAllGlobals());

it('inspects the target read-only before a confirmation can be constructed', async () => {
  request.mockResolvedValue(reply({ success: true, target }));
  expect(await client.setup.getProviderConnectionTarget('claude')).toEqual({
    success: true,
    target,
  });
  expect(request.mock.calls[0][0]).toContain('/api/setup/connection-target?provider=claude');
  expect(request.mock.calls[0][1].method).not.toBe('POST');
});

it('rejects missing confirmation locally without issuing a request', async () => {
  await expect(client.setup.disconnectProvider('claude', { target } as never)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it.each(['claude', 'codex', 'cursor', 'gemini', 'copilot', 'opencode'] as CliConnectionProvider[])(
  'sends explicit confirmation and the unmodified inspected %s target',
  async (provider) => {
    const selected = { ...target, provider };
    request.mockResolvedValue(
      reply({ success: true, connected: false, target: selected, message: 'done' })
    );
    await client.setup.disconnectProvider(provider, { confirmed: true, target: selected });
    expect(request.mock.calls[0][0]).toContain(`/api/setup/deauth-${provider}`);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      confirmed: true,
      target: selected,
    });
  }
);

it.each(['deauthClaude', 'deauthCursor', 'deauthCodex', 'deauthGemini', 'deauthOpencode'] as const)(
  'requires confirmation for the %s compatibility method too',
  async (method) => {
    await expect(client.setup[method](undefined as never)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  }
);

it('rejects a mismatched provider target before issuing a mutation', async () => {
  await expect(
    client.setup.disconnectProvider('codex', { confirmed: true, target })
  ).rejects.toThrow('does not match');
  expect(request).not.toHaveBeenCalled();
});

it('does not accept a response for a different instance as successful confirmation', async () => {
  request.mockResolvedValue(
    reply({
      success: true,
      connected: false,
      message: 'done',
      target: { ...target, instanceId: '62f89322-63ec-40f7-90b1-ef76c55a47ee' },
    })
  );
  await expect(
    client.setup.disconnectProvider('claude', { confirmed: true, target })
  ).rejects.toThrow('does not match');
});
