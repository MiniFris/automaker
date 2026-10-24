import { expect, it, vi } from 'vitest';
import { GithubAuthenticationService } from '../../../src/modules/providers/github-authentication.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';

function fixture(environment: NodeJS.ProcessEnv = {}) {
  const runtime = {
    detect: vi.fn().mockResolvedValue({ installed: true, path: '/owned/gh' }),
    githubAuthentication: vi.fn().mockResolvedValue({ authenticated: true, user: 'fixture-user' }),
  };
  const service = new GithubAuthenticationService(
    runtime as never,
    ProviderConnectionRepository.forWorkingDirectory('/backend'),
    environment
  );
  const request = async () =>
    ({ confirmed: true, target: (await service.target()).target }) as const;
  return { service, runtime, request };
}
it('previews only the host CLI target without checking authentication', async () => {
  const { service, runtime } = fixture({ GH_HOST: 'enterprise.test' });
  expect(await service.target()).toMatchObject({
    protocolVersion: 1,
    target: { workingDirectory: '/backend', cliPath: '/owned/gh', hostname: 'enterprise.test' },
  });
  expect(runtime.githubAuthentication).not.toHaveBeenCalled();
});
it.each([{}, { confirmed: false }, { confirmed: true, extra: true }])(
  'rejects ambiguous input before CLI authentication (%#)',
  async (input) => {
    const { service, runtime } = fixture();
    await expect(service.verify(input as never, 'client')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(runtime.githubAuthentication).not.toHaveBeenCalled();
  }
);
it.each(['instanceId', 'workingDirectory', 'cliPath', 'hostname'] as const)(
  'rejects stale %s before authentication',
  async (field) => {
    const { service, request, runtime } = fixture();
    const input = await request();
    const target = {
      ...input.target,
      [field]:
        field === 'instanceId'
          ? '62f89322-63ec-40f7-90b1-ef76c55a47ee'
          : field === 'hostname'
            ? 'other.test'
            : '/other',
    };
    await expect(service.verify({ ...input, target }, 'client')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(runtime.githubAuthentication).not.toHaveBeenCalled();
  }
);
it('runs the resolved CLI only after confirmation without changing environment or returning secrets', async () => {
  const before = { ...process.env };
  const { service, runtime, request } = fixture({ GH_TOKEN: 'private-token' });
  const input = await request();
  expect(await service.verify(input, 'client')).toEqual({
    success: true,
    authenticationChecked: true,
    authenticated: true,
    user: 'fixture-user',
    target: input.target,
  });
  expect(runtime.githubAuthentication).toHaveBeenCalledExactlyOnceWith('/owned/gh');
  expect(process.env).toEqual(before);
});
it('does not authenticate or run an absent CLI', async () => {
  const { service, runtime, request } = fixture();
  runtime.detect.mockResolvedValue({ installed: false, path: '' });
  expect((await service.verify(await request(), 'client')).authenticated).toBe(false);
  expect(runtime.githubAuthentication).not.toHaveBeenCalled();
});
it.each([null, 'private\nraw-token', 'null', 'x'.repeat(129)])(
  'does not accept malformed account evidence (%#)',
  async (user) => {
    const { service, runtime, request } = fixture();
    runtime.githubAuthentication.mockResolvedValue({ authenticated: true, user });
    expect(await service.verify(await request(), 'client')).toMatchObject({
      authenticated: false,
      user: null,
    });
  }
);
it('normalizes unexpected runtime failures', async () => {
  const { service, runtime, request } = fixture();
  runtime.githubAuthentication.mockRejectedValue(new Error('private-token /private/file'));
  await expect(service.verify(await request(), 'client')).rejects.toThrow(
    'GitHub authentication could not be checked.'
  );
});
it('limits attempts per application without a process-global limiter', async () => {
  const first = fixture();
  for (let count = 0; count < 5; count++)
    await first.service.verify(await first.request(), 'client');
  await expect(first.service.verify(await first.request(), 'client')).rejects.toMatchObject({
    status: 429,
  });
  const second = fixture();
  expect((await second.service.verify(await second.request(), 'client')).authenticated).toBe(true);
});
it('bounds concurrent checks and drains accepted work while closing admission', async () => {
  const { service, runtime, request } = fixture();
  const input = await request();
  let finish!: () => void;
  const held = new Promise((resolve) => {
    finish = () => resolve({ authenticated: true, user: 'fixture' });
  });
  runtime.githubAuthentication.mockReturnValue(held);
  const pending = Array.from({ length: 4 }, (_, index) => service.verify(input, `client-${index}`));
  await vi.waitFor(() => expect(runtime.githubAuthentication).toHaveBeenCalledTimes(4));
  await expect(service.verify(input, 'client-5')).rejects.toMatchObject({ statusCode: 503 });
  const closing = service.beforeApplicationShutdown();
  expect(service.beforeApplicationShutdown()).toBe(closing);
  await expect(service.target()).rejects.toMatchObject({ statusCode: 503 });
  finish();
  await Promise.all(pending);
  await closing;
});
