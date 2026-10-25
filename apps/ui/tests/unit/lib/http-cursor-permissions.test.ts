import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';

const request = vi.fn();
const target = {
  kind: 'host-cursor-permissions',
  provider: 'cursor',
  scope: 'project',
  projectPath: '/project',
  configPath: '/project/.cursor/cli.json',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
const preview = { success: true, protocolVersion: 1, target };
const reply = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => vi.stubGlobal('fetch', request));
afterEach(() => vi.unstubAllGlobals());

it.each(['profile', 'custom', 'delete'] as const)(
  'preflights and sends the exact confirmed target for %s',
  async (action) => {
    request
      .mockResolvedValueOnce(reply(preview))
      .mockResolvedValueOnce(reply({ success: true, target, message: 'saved' }));
    const api = new HttpApiClient().setup;
    const input = { confirmed: true, target } as const;
    if (action === 'profile')
      await api.applyCursorPermissionProfile({ ...input, profileId: 'strict' });
    else if (action === 'custom')
      await api.setCursorCustomPermissions({ ...input, permissions: { allow: [], deny: [] } });
    else await api.deleteCursorProjectPermissions(input);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toContain(
      '/api/setup/cursor-permissions/target?scope=project&projectPath=%2Fproject'
    );
    expect(request.mock.calls[0][1].method).not.toBe('POST');
    expect(request.mock.calls[1][1].method).toBe(action === 'delete' ? 'DELETE' : 'POST');
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject(input);
  }
);
it.each([
  reply({}, 404),
  reply({ ...preview, protocolVersion: 0 }),
  reply({ success: true, target }),
])('never mutates an older backend without preview support: %s', async (response) => {
  request.mockResolvedValue(response);
  await expect(
    new HttpApiClient().setup.applyCursorPermissionProfile({
      confirmed: true,
      target,
      profileId: 'strict',
    })
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][1].method).not.toBe('POST');
});
it.each(['configPath', 'instanceId', 'workingDirectory'] as const)(
  'does not replace an approved %s with a fresh preview',
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
      new HttpApiClient().setup.applyCursorPermissionProfile({
        confirmed: true,
        target,
        profileId: 'strict',
      })
    ).rejects.toThrow('target changed');
    expect(request).toHaveBeenCalledOnce();
  }
);
it('requires confirmation locally without any network call', async () => {
  await expect(
    new HttpApiClient().setup.applyCursorPermissionProfile({ target, profileId: 'strict' } as never)
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('rejects a successful response from a different target', async () => {
  request
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(
      reply({ success: true, target: { ...target, configPath: '/other' }, message: 'done' })
    );
  await expect(
    new HttpApiClient().setup.deleteCursorProjectPermissions({ confirmed: true, target })
  ).rejects.toThrow('does not match');
});
