import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
const fetchMock = vi.fn();
const target = {
  kind: 'host-github-authentication',
  provider: 'github',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
  cliPath: '/owned/gh',
  hostname: 'github.com',
} as const;
const preview = { success: true, protocolVersion: 1, target };
const result = {
  success: true,
  target,
  authenticationChecked: true,
  authenticated: true,
  user: 'fixture',
};
const reply = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => vi.unstubAllGlobals());
it('preflights and submits the exact approved target', async () => {
  fetchMock.mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(reply(result));
  expect(await new HttpApiClient().setup.verifyGithubAuth({ confirmed: true, target })).toEqual(
    result
  );
  expect(fetchMock.mock.calls[0][0]).toContain('/api/setup/github-authentication-target');
  expect(fetchMock.mock.calls[1][0]).toContain('/api/setup/verify-github-auth');
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirmed: true, target });
});
it.each([
  reply({}, 404),
  reply({ success: true, target }),
  reply({ ...preview, protocolVersion: 0 }),
])('does not POST to an unsupported backend (%#)', async (body) => {
  fetchMock.mockResolvedValue(body);
  await expect(
    new HttpApiClient().setup.verifyGithubAuth({ confirmed: true, target })
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each(['workingDirectory', 'cliPath', 'hostname'] as const)(
  'does not silently replace approved %s',
  async (field) => {
    fetchMock.mockResolvedValue(
      reply({
        ...preview,
        target: { ...target, [field]: field === 'hostname' ? 'other.test' : '/other' },
      })
    );
    await expect(
      new HttpApiClient().setup.verifyGithubAuth({ confirmed: true, target })
    ).rejects.toThrow('target changed');
    expect(fetchMock).toHaveBeenCalledOnce();
  }
);
it('requires explicit consent before any request', async () => {
  await expect(new HttpApiClient().setup.verifyGithubAuth({ target } as never)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('rejects a response from another target', async () => {
  fetchMock
    .mockResolvedValueOnce(reply(preview))
    .mockResolvedValueOnce(reply({ ...result, target: { ...target, cliPath: '/other' } }));
  await expect(
    new HttpApiClient().setup.verifyGithubAuth({ confirmed: true, target })
  ).rejects.toThrow('does not match');
});
