import fs from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createSecureFs } from '../src/secure-fs.js';
import { SecureFsQueue } from '../src/secure-fs-queue.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('bounds total accepted operations and preserves FIFO/concurrency without replacing active work', async () => {
  const queue = new SecureFsQueue({ maxOperations: 2 });
  queue.configureConcurrency(1);
  const entered = deferred(),
    release = deferred();
  const calls: number[] = [];
  const first = queue.run(async () => {
    calls.push(1);
    entered.resolve();
    await release.promise;
    return 1;
  });
  await entered.promise;
  const second = queue.run(async () => {
    calls.push(2);
    return 2;
  });
  await expect(queue.run(async () => 3)).rejects.toMatchObject({ code: 'FILESYSTEM_BUSY' });
  expect(queue.activeCount).toBe(1);
  expect(queue.pendingCount).toBe(1);
  expect(() => queue.configureConcurrency(2)).toThrow('in flight');
  release.resolve();
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(calls).toEqual([1, 2]);
  expect(queue.activeCount).toBe(0);
  await queue.close();
});

it('rejects queued callers immediately, waits for dispatched IO and caches close before abort callbacks', async () => {
  const queue = new SecureFsQueue();
  queue.configureConcurrency(1);
  const entered = deferred(),
    release = deferred();
  const first = queue.run(async () => {
    entered.resolve();
    await release.promise;
    return 'confirmed';
  });
  await entered.promise;
  const work = vi.fn(async () => 'not dispatched');
  const pending = queue.run(work);
  const denied = expect(pending).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  const close = queue.close();
  let settled = false;
  void close.then(() => {
    settled = true;
  });
  expect(queue.close()).toBe(close);
  await denied;
  await expect(queue.run(work)).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  expect(settled).toBe(false);
  expect(queue.activeCount).toBe(1);
  expect(queue.pendingCount).toBe(0);
  release.resolve();
  expect(await first).toBe('confirmed');
  await close;
  expect(work).not.toHaveBeenCalled();
  expect(queue.activeCount).toBe(0);
});

it('does not forget unconfirmed IO or turn a late confirmation into a successful cached shutdown', async () => {
  vi.useFakeTimers();
  const queue = new SecureFsQueue({ shutdownTimeoutMs: 20 });
  const entered = deferred(),
    release = deferred();
  const active = queue.run(async () => {
    entered.resolve();
    await release.promise;
    return 'late confirmed';
  });
  await entered.promise;
  const close = queue.close();
  const failed = expect(close).rejects.toMatchObject({ code: 'FILESYSTEM_CLEANUP_UNCONFIRMED' });
  await vi.advanceTimersByTimeAsync(20);
  await failed;
  expect(queue.activeCount).toBe(1);
  await expect(queue.run(async () => {})).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  release.resolve();
  expect(await active).toBe('late confirmed');
  expect(queue.activeCount).toBe(0);
  expect(queue.close()).toBe(close);
  await expect(queue.close()).rejects.toMatchObject({ code: 'FILESYSTEM_CLEANUP_UNCONFIRMED' });
});

it('cancels retry timers and never dispatches another retry after close', async () => {
  vi.useFakeTimers();
  const entered = deferred();
  const retry = vi.fn();
  const queue = new SecureFsQueue();
  const active = queue.run(async () => {
    entered.resolve();
    await queue.retryDelay(10_000);
    retry();
  });
  const refused = expect(active).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  await entered.promise;
  const close = queue.close();
  await refused;
  await close;
  expect(vi.getTimerCount()).toBe(0);
  expect(retry).not.toHaveBeenCalled();
});

it('refuses synchronous and asynchronous factory IO after closing without invoking the policy or filesystem', async () => {
  const policy = vi.fn((candidate: string) => candidate);
  const scoped = createSecureFs(policy);
  await scoped.close();
  expect(() => scoped.existsSync('/not-opened')).toThrow(
    expect.objectContaining({ code: 'FILESYSTEM_CLOSED' })
  );
  await expect(scoped.readFile('/not-opened')).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  expect(() => scoped.configureThrottling({ maxConcurrency: 1 })).toThrow('closing');
  expect(scoped.joinPath('one', 'two')).toContain('two');
  expect(policy).not.toHaveBeenCalled();
});

it('owns a whole compound env operation and refuses a new write after its dispatched read drains', async () => {
  const entered = deferred(),
    release = deferred();
  const read = vi.spyOn(fs, 'readFile').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return 'OWNED=before\n';
  });
  const write = vi.spyOn(fs, 'writeFile').mockResolvedValue();
  const scoped = createSecureFs((candidate) => candidate);
  const active = scoped.writeEnvKey('/owned-fixture.env', 'OWNED', 'after');
  const refused = expect(active).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  await entered.promise;
  const close = scoped.close();
  expect(scoped.getActiveOperations()).toBe(1);
  release.resolve();
  await refused;
  await close;
  expect(read).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  expect(scoped.getActiveOperations()).toBe(0);
});

it('has independent admission and close states for independent scoped instances', async () => {
  const first = createSecureFs((candidate) => candidate),
    second = createSecureFs((candidate) => candidate);
  const read = vi.spyOn(fs, 'readFile').mockResolvedValue('owned');
  await first.close();
  await expect(first.readFile('/not-opened')).rejects.toMatchObject({ code: 'FILESYSTEM_CLOSED' });
  expect(await second.readFile('/owned-fixture', 'utf8')).toBe('owned');
  expect(read).toHaveBeenCalledOnce();
  await second.close();
});

it.each([{ maxOperations: 0 }, { shutdownTimeoutMs: 0 }, { shutdownTimeoutMs: Infinity }])(
  'rejects invalid owner configuration (%#)',
  (options) => {
    expect(() => createSecureFs((candidate) => candidate, options)).toThrow('configuration');
  }
);
