import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';

const request = vi.fn();
const target = {
  kind: 'host-cursor-model-config',
  provider: 'cursor',
  scope: 'project',
  projectPath: '/project',
  configPath: '/project/.automaker/cursor-config.json',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
const preview = { success: true, protocolVersion: 1, target };
const reply = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => {
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.unstubAllGlobals());
it.each(['default', 'enabled'] as const)(
  'preflights %s and sends only the original approved target',
  async (action) => {
    request.mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(
      reply({
        success: true,
        target,
        ...(action === 'default' ? { model: 'cursor-auto' } : { models: ['cursor-auto'] }),
      })
    );
    const api = new HttpApiClient().setup;
    if (action === 'default')
      await api.setCursorDefaultModel({ confirmed: true, target, model: 'cursor-auto' });
    else await api.setCursorModels({ confirmed: true, target, models: ['cursor-auto'] });
    expect(request.mock.calls[0][0]).toContain(
      '/api/setup/cursor-config/target?projectPath=%2Fproject'
    );
    expect(request.mock.calls[1][0]).toContain(
      action === 'default'
        ? '/api/setup/cursor-config/default-model'
        : '/api/setup/cursor-config/models'
    );
    expect(request.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ confirmed: true, target });
  }
);
it.each([
  reply({}, 404),
  reply({ success: true, target }),
  reply({ ...preview, protocolVersion: 0 }),
])('does not POST to a backend without model-config protocol support (%#)', async (body) => {
  request.mockResolvedValue(body);
  await expect(
    new HttpApiClient().setup.setCursorDefaultModel({
      confirmed: true,
      target,
      model: 'cursor-auto',
    })
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].method).not.toBe('POST');
});
it.each(['configPath', 'instanceId', 'projectPath', 'workingDirectory'] as const)(
  'does not substitute a changed %s into confirmation',
  async (field) => {
    request.mockResolvedValue(
      reply({
        ...preview,
        target: {
          ...target,
          [field]: field === 'instanceId' ? '62f89322-63ec-40f7-90b1-ef76c55a47ee' : '/other',
        },
      })
    );
    await expect(
      new HttpApiClient().setup.setCursorModels({
        confirmed: true,
        target,
        models: ['cursor-auto'],
      })
    ).rejects.toThrow('target changed');
    expect(request).toHaveBeenCalledOnce();
  }
);
it('rejects missing confirmation locally', async () => {
  await expect(
    new HttpApiClient().setup.setCursorDefaultModel({ target, model: 'cursor-auto' } as never)
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it.each(['target', 'model'] as const)(
  'rejects a successful response with different %s',
  async (field) => {
    request.mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(
      reply({
        success: true,
        target: field === 'target' ? { ...target, configPath: '/other' } : target,
        model: field === 'model' ? 'cursor-sonnet-4.6' : 'cursor-auto',
      })
    );
    await expect(
      new HttpApiClient().setup.setCursorDefaultModel({
        confirmed: true,
        target,
        model: 'cursor-auto',
      })
    ).rejects.toThrow('does not match');
  }
);
it('validates the enabled-model list in the response', async () => {
  request
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply({ success: true, target, models: ['cursor-sonnet-4.6'] }));
  await expect(
    new HttpApiClient().setup.setCursorModels({ confirmed: true, target, models: ['cursor-auto'] })
  ).rejects.toThrow('does not match');
});
it('parses actual Cursor metadata rather than requiring an invented tier', async () => {
  const body = {
    success: true,
    target,
    config: { mcpServers: ['server'], future: true },
    availableModels: [
      {
        id: 'cursor-auto',
        label: 'Auto',
        description: 'Auto',
        hasThinking: false,
        supportsVision: false,
      },
    ],
  };
  request.mockResolvedValue(reply(body));
  expect(await new HttpApiClient().setup.getCursorConfig('/project')).toEqual(body);
});
