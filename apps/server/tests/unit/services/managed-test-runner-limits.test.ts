import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { ProjectGitTarget } from '@/services/execution-environment/project-git.js';
import { ManagedTestRunnerService } from '@/services/execution-environment/test-runner.js';
import { ManagedTerminalPty } from '@/services/execution-environment/terminal.js';
import { SettingsService } from '@/services/settings-service.js';
import { createEventEmitter } from '@/lib/events.js';

let service: ManagedTestRunnerService, settings: SettingsService;
const target = (id: number) =>
  ({
    environment: {
      type: 'ssh',
      projectPath: '/project',
      path: `/project/.worktrees/${id}`,
      runtimeCwd: `/target/${id}`,
      root: '/target',
      targetId: `target-${id}`,
      pinned: true,
    },
    runtime: { type: 'ssh', cwd: `/target/${id}` },
  }) as ProjectGitTarget;
const transport = (completed = false) => {
  let exit: (event: { exitCode: number }) => void;
  const pty = {
    exitConfirmed: true,
    onData: vi.fn(),
    onExit: (callback: typeof exit) => {
      exit = callback;
      if (completed) exit({ exitCode: 0 });
    },
    kill: vi.fn(() => exit({ exitCode: -9 })),
  };
  return { pty } as unknown as Awaited<ReturnType<typeof ManagedTerminalPty.open>>;
};
beforeEach(() => {
  settings = new SettingsService('/unused-managed-test-fixture');
  vi.spyOn(settings, 'getProjectSettings').mockResolvedValue({ version: 1, testCommand: 'true' });
  service = new ManagedTestRunnerService(settings, createEventEmitter());
});
afterEach(async () => {
  await service.cleanup();
  vi.restoreAllMocks();
});

it('counts pending handshakes in the eight-session limit', async () => {
  const release: Array<() => void> = [];
  vi.spyOn(ManagedTerminalPty, 'open').mockImplementation(
    () => new Promise((resolve) => release.push(() => resolve(transport())))
  );
  const starts = Array.from({ length: 8 }, (_, id) =>
    service.start(target(id), `target-${id}`, undefined)
  );
  await vi.waitFor(() => expect(release).toHaveLength(8));
  await expect(service.start(target(9), 'target-9', undefined)).rejects.toMatchObject({
    code: 'TEST_SESSION_LIMIT',
  });
  release.forEach((ready) => ready());
  expect(await Promise.all(starts)).toHaveLength(8);
});
it('waits for pending opens on shutdown, stops their captured transport and rejects new starts', async () => {
  let release!: () => void;
  const remote = transport();
  vi.spyOn(ManagedTerminalPty, 'open').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve(remote);
      })
  );
  const started = service.start(target(1), 'target-1', undefined);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let closed = false;
  const cleanup = service.cleanup().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  await expect(service.start(target(2), 'target-2', undefined)).rejects.toMatchObject({
    code: 'TEST_RUNNER_CLOSING',
  });
  release();
  await started;
  await cleanup;
  expect(remote.pty.kill).toHaveBeenCalledOnce();
  expect(service.find('/project/.worktrees/1')?.status).toBe('cancelled');
});
it('retains at most 100 completed records and does not recreate evicted IDs', async () => {
  vi.spyOn(ManagedTerminalPty, 'open').mockImplementation(async () => transport(true));
  const first = await service.start(target(1), 'target-1', undefined);
  for (let count = 0; count < 100; count++) await service.start(target(1), 'target-1', undefined);
  expect(service.find(undefined, first.sessionId)).toBeUndefined();
  await expect(service.stop(first.sessionId)).rejects.toMatchObject({ code: 'TEST_SESSION_GONE' });
  expect(service.find('/project/.worktrees/1')?.status).toBe('passed');
});
