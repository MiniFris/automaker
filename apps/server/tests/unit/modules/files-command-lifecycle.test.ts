import { afterEach, expect, it, vi } from 'vitest';
import { FilesCommandService } from '../../../src/modules/files/files-command.service.js';
import type { ProjectFilePort } from '../../../src/modules/files/project-file.port.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

it('drains accepted atomic commands in order before refusing all replacements', async () => {
  const entered = deferred(),
    release = deferred();
  const calls: string[] = [];
  const files = {
    write: vi.fn(async (name: string) => {
      calls.push(name);
      if (name === 'first') {
        entered.resolve();
        await release.promise;
      }
    }),
  };
  const commands = new FilesCommandService(files as unknown as ProjectFilePort);
  const first = commands.write('first', 'owned');
  await entered.promise;
  const second = commands.write('second', 'owned');
  const close = commands.onModuleDestroy();
  let ended = false;
  void close.then(() => {
    ended = true;
  });
  expect(commands.onModuleDestroy()).toBe(close);
  await expect(commands.write('replacement', 'never')).rejects.toMatchObject({
    errorCode: 'UNAVAILABLE',
  });
  expect(ended).toBe(false);
  release.resolve();
  await Promise.all([first, second, close]);
  expect(calls).toEqual(['first', 'second']);
});

it('bounds the command backlog independently of filesystem primitive concurrency', async () => {
  const release = deferred();
  const files = { write: vi.fn(() => release.promise) };
  const commands = new FilesCommandService(files as unknown as ProjectFilePort);
  const accepted = Array.from({ length: 256 }, (_, index) =>
    commands.write(String(index), 'owned')
  );
  const settled = Promise.all(accepted);
  await expect(commands.write('overflow', 'never')).rejects.toMatchObject({
    errorCode: 'UNAVAILABLE',
  });
  release.resolve();
  await settled;
  await commands.onModuleDestroy();
  expect(files.write).toHaveBeenCalledTimes(256);
});

it('reports an unconfirmed domain drain without forgetting or replacing pending commands', async () => {
  vi.useFakeTimers();
  const entered = deferred(),
    release = deferred();
  const commands = new FilesCommandService({
    write: async () => {
      entered.resolve();
      await release.promise;
    },
  } as unknown as ProjectFilePort);
  const active = commands.write('held', 'owned');
  await entered.promise;
  const close = commands.onModuleDestroy();
  const failed = expect(close).rejects.toMatchObject({ code: 'FILE_COMMAND_DRAIN_UNCONFIRMED' });
  await vi.advanceTimersByTimeAsync(5000);
  await failed;
  await expect(commands.write('replacement', 'never')).rejects.toMatchObject({
    errorCode: 'UNAVAILABLE',
  });
  release.resolve();
  await active;
  await expect(commands.onModuleDestroy()).rejects.toMatchObject({
    code: 'FILE_COMMAND_DRAIN_UNCONFIRMED',
  });
});
