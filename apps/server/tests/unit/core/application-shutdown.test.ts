import { expect, it, vi } from 'vitest';
import { manageApplicationShutdown } from '../../../src/core/lifecycle/application-shutdown.js';

it('rejects shutdown after a framework-swallowed hook error, without exposing its private detail', async () => {
  const actor = {
    beforeApplicationShutdown: vi.fn().mockRejectedValue(new Error('private-hook-detail')),
  };
  const close = vi.fn(async () => {
    try {
      await actor.beforeApplicationShutdown();
    } catch {}
  });
  const map = new Map([
    [
      'fixture',
      {
        providers: new Map([['actor', { instance: actor }]]),
        controllers: new Map(),
        injectables: new Map(),
        middlewares: new Map(),
      },
    ],
  ]);
  const app = { get: () => map, close };
  manageApplicationShutdown(app as never);
  const first = app.close();
  expect(app.close()).toBe(first);
  await expect(first).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  await expect(first).rejects.not.toThrow('private-hook-detail');
  expect(close).toHaveBeenCalledOnce();
});

it('preserves receiver binding and shares successful explicit close without installing signal handlers', async () => {
  const actor = {
    value: 2,
    onApplicationShutdown: vi.fn(function (this: { value: number }) {
      expect(this.value).toBe(2);
    }),
  };
  const notify = actor.onApplicationShutdown;
  const map = new Map([
    [
      'fixture',
      {
        providers: new Map([
          ['actor', { instance: actor }],
          ['alias', { instance: actor }],
        ]),
        controllers: new Map(),
        injectables: new Map(),
        middlewares: new Map(),
      },
    ],
  ]);
  const app = {
    get: () => map,
    close: vi.fn(async () => {
      await actor.onApplicationShutdown();
    }),
  };
  const count = process.listenerCount('SIGTERM');
  manageApplicationShutdown(app as never);
  await app.close();
  await app.close();
  expect(notify).toHaveBeenCalledOnce();
  expect(process.listenerCount('SIGTERM')).toBe(count);
});

it('checks unconfirmed HTTP disposal only after the framework attempted all later provider hooks', async () => {
  const events: string[] = [];
  const app = {
    get: () => new Map(),
    getHttpAdapter: () => ({
      assertCleanupConfirmed: () => {
        events.push('checked transport');
        throw new Error('private-socket-detail');
      },
    }),
    close: vi.fn(async () => {
      events.push('later provider disposed');
    }),
  };
  manageApplicationShutdown(app as never);
  const close = app.close();
  await expect(close).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  await expect(close).rejects.not.toThrow('private-socket-detail');
  expect(events).toEqual(['later provider disposed', 'checked transport']);
  expect(app.close()).toBe(close);
});
