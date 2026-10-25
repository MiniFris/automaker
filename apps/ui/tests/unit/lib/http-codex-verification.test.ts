import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
const request = vi.fn();
const target = {
  kind: 'host-codex-verification',
  provider: 'codex',
  authMethod: 'api_key',
  credentialKind: 'api-key',
  endpoint: 'https://api.openai.com/v1/responses',
  model: 'gpt-5.2-codex',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
const preview = { success: true, protocolVersion: 1, target };
const response = {
  success: true,
  target,
  authType: 'api_key',
  authenticated: true,
  verification: 'verified',
};
const reply = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => {
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());
it('preflights and sends the exact approved target and unsaved key without persisting it', async () => {
  request.mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(reply(response));
  const input = { confirmed: true, target, apiKey: 'sk-fixture-private-123456' } as const;
  expect(await new HttpApiClient().setup.verifyCodexAuth(input)).toEqual(response);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).toContain(
    '/api/setup/codex-verification-target?authMethod=api_key'
  );
  expect(request.mock.calls[1][0]).toContain('/api/setup/verify-codex-auth');
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual(input);
});
it.each([
  reply({}, 404),
  reply({ success: true, target }),
  reply({ ...preview, protocolVersion: 0 }),
])('does not POST to a backend lacking confirmed verification capability (%#)', async (body) => {
  request.mockResolvedValue(body);
  await expect(
    new HttpApiClient().setup.verifyCodexAuth({ confirmed: true, target })
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].method).not.toBe('POST');
});
it.each(['instanceId', 'workingDirectory', 'endpoint'] as const)(
  'does not replace approved %s from a new preview',
  async (field) => {
    request.mockResolvedValue(
      reply({
        ...preview,
        target: {
          ...target,
          [field]:
            field === 'instanceId'
              ? '62f89322-63ec-40f7-90b1-ef76c55a47ee'
              : field === 'endpoint'
                ? 'https://other.test/'
                : '/other',
        },
      })
    );
    await expect(
      new HttpApiClient().setup.verifyCodexAuth({ confirmed: true, target })
    ).rejects.toThrow('target changed');
    expect(request).toHaveBeenCalledOnce();
  }
);
it('requires consent before issuing any request', async () => {
  await expect(new HttpApiClient().setup.verifyCodexAuth({ target } as never)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('rejects a result attributed to another backend target', async () => {
  request
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(
      reply({ ...response, target: { ...target, workingDirectory: '/other' } })
    );
  await expect(
    new HttpApiClient().setup.verifyCodexAuth({ confirmed: true, target })
  ).rejects.toThrow('does not match');
});
it('rejects a preview for another auth method', async () => {
  request.mockResolvedValue(
    reply({
      ...preview,
      target: { ...target, authMethod: 'cli', credentialDirectory: '/backend/.codex' },
    })
  );
  await expect(new HttpApiClient().setup.getCodexVerificationTarget('api_key')).rejects.toThrow(
    'does not match'
  );
});
it.each(['credentialKind', 'credentialDirectory'] as const)(
  'does not POST after a CLI %s change',
  async (field) => {
    const cli = { ...target, authMethod: 'cli' as const, credentialDirectory: '/backend/.codex' };
    request.mockResolvedValue(
      reply({
        ...preview,
        target: { ...cli, [field]: field === 'credentialKind' ? 'chatgpt' : '/other/.codex' },
      })
    );
    await expect(
      new HttpApiClient().setup.verifyCodexAuth({ confirmed: true, target: cli })
    ).rejects.toThrow('target changed');
    expect(request).toHaveBeenCalledOnce();
  }
);
