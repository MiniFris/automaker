import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
import { CliConnectionProviderSchema } from '@automaker/contracts';

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

it.each(CliConnectionProviderSchema.options)(
  're-inspects protocol/target before sending a confirmed %s reconnect',
  async (provider) => {
    const selected = { ...target, provider };
    request
      .mockResolvedValueOnce(reply({ success: true, protocolVersion: 3, target: selected }))
      .mockResolvedValueOnce(
        reply({
          success: true,
          connected: true,
          target: selected,
          message: 'connected',
          credentialStatus: 'not-inspected',
        })
      );
    expect(
      (await client.setup.reconnectProvider(provider, { confirmed: true, target: selected }))
        .connected
    ).toBe(true);
    expect(request.mock.calls[0][0]).toContain(`/api/setup/connection-target?provider=${provider}`);
    expect(request.mock.calls[0][1].method).not.toBe('POST');
    expect(request.mock.calls[1][0]).toContain(`/api/setup/auth-${provider}`);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      confirmed: true,
      target: selected,
    });
  }
);

it('does not POST to an API v2 server whose legacy auth endpoints ignore request bodies', async () => {
  request.mockResolvedValue(reply({ success: true, target }));
  await expect(
    client.setup.reconnectProvider('claude', { confirmed: true, target })
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].method).not.toBe('POST');
});

it('does not replace a user-approved target after an instance restart', async () => {
  request.mockResolvedValue(
    reply({
      success: true,
      protocolVersion: 3,
      target: { ...target, instanceId: '62f89322-63ec-40f7-90b1-ef76c55a47ee' },
    })
  );
  await expect(
    client.setup.reconnectProvider('claude', { confirmed: true, target })
  ).rejects.toThrow('target changed');
  expect(request).toHaveBeenCalledOnce();
});

it('does not send an unconfirmed or mismatched-provider reconnect', async () => {
  await expect(client.setup.reconnectProvider('claude', { target } as never)).rejects.toThrow();
  await expect(
    client.setup.reconnectProvider('codex', { confirmed: true, target })
  ).rejects.toThrow('does not match');
  expect(request).not.toHaveBeenCalled();
});

it.each(['authClaude', 'authCodex', 'authCursor', 'authGemini', 'authOpencode'] as const)(
  'requires confirmation for %s compatibility method',
  async (name) => {
    await expect(client.setup[name](undefined as never)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  }
);

it('does not accept another target in the reconnect response', async () => {
  request
    .mockResolvedValueOnce(reply({ success: true, protocolVersion: 3, target }))
    .mockResolvedValueOnce(
      reply({
        success: true,
        connected: true,
        target: { ...target, workingDirectory: '/other' },
        message: 'connected',
        credentialStatus: 'not-inspected',
      })
    );
  await expect(
    client.setup.reconnectProvider('claude', { confirmed: true, target })
  ).rejects.toThrow('does not match');
});
