import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ProjectEventStorage,
  type ProjectEventFilesystem,
} from '../../../src/services/project-event-storage.js';

afterEach(() => vi.useRealTimers());

it('serializes one project while other projects proceed and a failed operation releases the lane', async () => {
  const storage = new ProjectEventStorage({} as ProjectEventFilesystem, 'Fixture', path.resolve);
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = storage.run('/one', () => entered);
  const queued = vi.fn().mockRejectedValue(new Error('fixture IO'));
  const second = expect(storage.run('/one', queued)).rejects.toThrow('fixture IO');
  await storage.run('/two', async () => {});
  expect(queued).not.toHaveBeenCalled();
  release();
  await first;
  await second;
  await expect(storage.run('/one', async () => 'next')).resolves.toBe('next');
  await storage.close();
});

it('bounds accepted work and closes admission while draining accepted mutations', async () => {
  const storage = new ProjectEventStorage({} as ProjectEventFilesystem, 'Fixture', path.resolve);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const accepted = Array.from({ length: 256 }, () => storage.run('/project', () => blocked));
  await expect(storage.run('/project', async () => {})).rejects.toMatchObject({ statusCode: 503 });
  let closed = false;
  const closing = storage.close().then(() => {
    closed = true;
  });
  await expect(storage.run('/other-project', async () => {})).rejects.toMatchObject({
    statusCode: 503,
  });
  expect(closed).toBe(false);
  release();
  await Promise.all(accepted);
  await closing;
});

it('reports an unconfirmed drain after the finite deadline', async () => {
  vi.useFakeTimers();
  const storage = new ProjectEventStorage({} as ProjectEventFilesystem, 'Fixture', path.resolve);
  let release!: () => void;
  const blocked = storage.run(
    '/project',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await Promise.resolve();
  const closing = expect(storage.close()).rejects.toThrow('cleanup could not be confirmed');
  await vi.advanceTimersByTimeAsync(5000);
  await closing;
  release();
  await blocked;
});
