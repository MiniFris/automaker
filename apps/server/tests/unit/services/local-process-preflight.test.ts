import { expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { DevServerService } from '../../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../../src/services/test-runner-service.js';
vi.mock('child_process', async () => ({
  ...(await vi.importActual('child_process')),
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

const runtime = () => ({
  filesystem: {
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    access: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
  },
  stateFilesystem: {} as never,
  dataDirectory: '/data',
  resolvePath: vi.fn((candidate: string) => '/canonical/' + candidate),
});

it('pins the canonical cwd and uses only native stat/access for command discovery', async () => {
  const port = runtime();
  const dev = new DevServerService(port);
  expect(await dev.startDevServer('project', 'worktree')).toEqual({
    success: false,
    error: 'No package.json found in: worktree',
  });
  expect(port.filesystem.stat).toHaveBeenCalledWith('/canonical/worktree');
  expect(port.filesystem.access).toHaveBeenCalledExactlyOnceWith(
    '/canonical/worktree/package.json'
  );
  const tests = new TestRunnerService(port);
  expect(await tests.startTests('worktree', { command: '' })).toEqual({
    success: false,
    error: 'No test command provided',
  });
  expect(spawn).not.toHaveBeenCalled();
  await dev.stopAll();
  await tests.cleanup();
});

it('propagates DENIED/EIO preflight without fallback, allocation or spawn', async () => {
  for (const code of ['EACCES', 'EIO']) {
    const port = runtime();
    const error = Object.assign(new Error('native IO failed'), { code });
    port.filesystem.stat.mockRejectedValue(error);
    const dev = new DevServerService(port);
    const tests = new TestRunnerService(port);
    const allocation = vi.spyOn(
      dev as unknown as { findAvailablePort: () => Promise<number> },
      'findAvailablePort'
    );
    await expect(dev.startDevServer('project', 'worktree', 'never')).rejects.toBe(error);
    await expect(tests.startTests('worktree', { command: 'never' })).rejects.toBe(error);
    expect(port.filesystem.access).not.toHaveBeenCalled();
    expect(allocation).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    await dev.stopAll();
    await tests.cleanup();
  }
});

it('does not choose a fallback package manager after indeterminate lockfile discovery', async () => {
  const port = runtime();
  const error = Object.assign(new Error('native IO failed'), { code: 'EIO' });
  port.filesystem.access.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
  const dev = new DevServerService(port);
  await expect(dev.startDevServer('project', 'worktree')).rejects.toBe(error);
  expect(port.filesystem.access.mock.calls.map(([file]) => file)).toEqual([
    '/canonical/worktree/package.json',
    '/canonical/worktree/bun.lockb',
  ]);
  expect(spawn).not.toHaveBeenCalled();
  await dev.stopAll();
});

it('retains timed-out accepted native preflight until it really settles and caches failed cleanup', async () => {
  vi.useFakeTimers();
  try {
    for (const owner of ['dev', 'tests'] as const) {
      const port = runtime();
      let release!: (value: { isDirectory: () => boolean }) => void;
      port.filesystem.stat.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const dev = new DevServerService(port);
      const tests = new TestRunnerService(port);
      const instance = owner === 'dev' ? dev : tests;
      const start =
        owner === 'dev'
          ? dev.startDevServer('project', 'worktree', 'never')
          : tests.startTests('worktree', { command: 'never' });
      const close = () => (owner === 'dev' ? dev.stopAll() : tests.cleanup());
      const closing = close();
      const failed = expect(closing).rejects.toThrow('cleanup could not be confirmed');
      await vi.advanceTimersByTimeAsync(5000);
      await failed;
      expect(
        (instance as unknown as { acceptedStarts: Set<Promise<unknown>> }).acceptedStarts.size
      ).toBe(1);
      release({ isDirectory: () => true });
      await expect(start).resolves.toMatchObject({ success: false });
      expect(
        (instance as unknown as { acceptedStarts: Set<Promise<unknown>> }).acceptedStarts.size
      ).toBe(0);
      expect(close()).toBe(closing);
      await expect(close()).rejects.toThrow('cleanup could not be confirmed');
      expect(spawn).not.toHaveBeenCalled();
    }
  } finally {
    vi.useRealTimers();
  }
});
