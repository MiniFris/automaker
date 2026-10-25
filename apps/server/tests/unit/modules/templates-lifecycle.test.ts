import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SpawnTemplateCommandRunner,
  type TemplateCommandRunner,
} from '../../../src/modules/templates/template-command.runner.js';
import { TemplatesService } from '../../../src/modules/templates/templates.service.js';
import { OwnedLocalChildCleanupError } from '../../../src/services/owned-local-child.js';
afterEach(() => vi.useRealTimers());

function service(commands: TemplateCommandRunner) {
  const filesystem = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    lstat: vi.fn().mockResolvedValue({ isDirectory: () => true, dev: 1, ino: 2 }),
    rm: vi.fn().mockResolvedValue(undefined),
  };
  return {
    filesystem,
    owner: new TemplatesService(
      filesystem as never,
      { validateLocalPath: (candidate: string) => candidate } as never,
      commands
    ),
  };
}
const input = {
  parentDir: '/offline',
  projectName: 'project',
  repoUrl: 'https://github.com/offline/template',
};
it('does not admit filesystem work or commands after same-tick workflow shutdown', async () => {
  const run = vi.fn();
  const { owner, filesystem } = service({ run });
  const pending = owner.clone(input),
    closed = owner.onModuleDestroy();
  await expect(pending).rejects.toMatchObject({ errorCode: 'CANCELLED' });
  await closed;
  expect(run).not.toHaveBeenCalled();
  expect(filesystem.mkdir).not.toHaveBeenCalled();
  await expect(owner.clone(input)).rejects.toMatchObject({ statusCode: 503 });
});
it.each(['unknown-command', 'replaced-directory', 'cleanup-EIO'] as const)(
  'retains target admission when %s makes cleanup unsafe',
  async (kind) => {
    const commands = {
      run: vi.fn().mockImplementation(async () => {
        if (kind === 'unknown-command') throw new OwnedLocalChildCleanupError();
        return { exitCode: 128, stderr: 'known failure' };
      }),
    };
    const { owner, filesystem } = service(commands);
    if (kind === 'replaced-directory')
      filesystem.lstat
        .mockResolvedValueOnce({ isDirectory: () => true, dev: 1, ino: 2 })
        .mockResolvedValue({ isDirectory: () => true, dev: 1, ino: 3 });
    if (kind === 'cleanup-EIO')
      filesystem.rm.mockRejectedValue(
        Object.assign(new Error('owned EIO fixture'), { code: 'EIO' })
      );
    await expect(owner.clone(input)).rejects.toMatchObject({ statusCode: 503 });
    await expect(owner.clone(input)).rejects.toMatchObject({ statusCode: 409 });
    if (kind !== 'cleanup-EIO') expect(filesystem.rm).not.toHaveBeenCalled();
    await expect(owner.onModuleDestroy()).rejects.toMatchObject({
      code: 'TEMPLATE_WORKFLOW_CLEANUP_FAILED',
    });
  }
);
it('releases a known failed clone only after cleaning its own target and permits a clean retry', async () => {
  const commands = {
    run: vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 128, stderr: '' })
      .mockResolvedValue({ exitCode: 0, stderr: '' }),
  };
  const { owner, filesystem } = service(commands);
  await expect(owner.clone(input)).rejects.toThrow('Failed to clone repository');
  expect(filesystem.rm).toHaveBeenNthCalledWith(1, '/offline/project', {
    recursive: true,
    force: true,
  });
  expect(await owner.clone(input)).toMatchObject({ success: true });
  await owner.onModuleDestroy();
});
it('closes accepted command admission before queued commands can spawn', async () => {
  const spawn = vi.fn();
  const runner = new SpawnTemplateCommandRunner({ platform: 'linux', spawn });
  const pending = runner.run('git', ['clone'], '/unused');
  const closed = runner.onModuleDestroy();
  await expect(pending).rejects.toMatchObject({ errorCode: 'CANCELLED' });
  await closed;
  expect(spawn).not.toHaveBeenCalled();
  await expect(runner.run('git', [], '/unused')).rejects.toMatchObject({ statusCode: 503 });
});
it.each(['darwin', 'win32'] as const)(
  'preserves ordinary %s command completion without claiming Linux tree proof',
  async (platform) => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
      stderr: null,
    });
    const runner = new SpawnTemplateCommandRunner({ platform, spawn: () => child as never });
    const pending = runner.run('offline-fixture', [], '/unused');
    await Promise.resolve();
    child.emit('close', 0);
    expect(await pending).toEqual({ exitCode: 0, stderr: '' });
    await runner.onModuleDestroy();
    expect(child.kill).not.toHaveBeenCalled();
  }
);
it('retains a bounded whole-workflow close failure and never runs init after a late clone return', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commands = {
    run: vi.fn(async () => {
      await held;
      return { exitCode: 0, stderr: '' };
    }),
  };
  const { owner } = service(commands);
  const pending = owner.clone(input);
  await vi.advanceTimersByTimeAsync(0);
  expect(commands.run).toHaveBeenCalledTimes(1);
  const close = owner.onModuleDestroy();
  const failure = expect(close).rejects.toMatchObject({ code: 'TEMPLATE_WORKFLOW_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(10000);
  await failure;
  release();
  await expect(pending).rejects.toMatchObject({ errorCode: 'CANCELLED' });
  expect(commands.run).toHaveBeenCalledTimes(1);
  expect(owner.onModuleDestroy()).toBe(close);
});
it.skipIf(process.platform !== 'linux')(
  'releases affirmative no-spawn failure and preserves known nonzero command results',
  async () => {
    const runner = new SpawnTemplateCommandRunner({
      platform: 'linux',
      spawn: (command, _, cwd) =>
        command === 'missing'
          ? spawn(path.join(os.tmpdir(), `template-private-missing-${randomUUID()}`), [], {
              cwd,
              detached: true,
              stdio: ['ignore', 'ignore', 'pipe'],
            })
          : spawn(
              process.execPath,
              ['-e', "process.stderr.write('owned command fixture');process.exitCode=7;"],
              { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'] }
            ),
    });
    try {
      await expect(runner.run('missing', [], os.tmpdir())).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await runner.run('fixture', [], os.tmpdir())).toMatchObject({ exitCode: 7 });
    } finally {
      await runner.onModuleDestroy();
    }
  }
);
