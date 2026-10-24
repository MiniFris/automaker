import { describe, expect, it } from 'vitest';
import { SettingsMutationQueue } from '../../../src/services/settings-mutation-queue.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('settings transaction ownership', () => {
  it('serializes one key while allowing independent settings files to proceed', async () => {
    const queue = new SettingsMutationQueue();
    const held = deferred();
    const order: string[] = [];
    const first = queue.run('global', async () => {
      await held.promise;
      order.push('first');
    });
    const second = queue.run('global', async () => {
      order.push('second');
    });
    await queue.run('credentials', async () => {
      order.push('credentials');
    });
    expect(order).toEqual(['credentials']);
    held.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['credentials', 'first', 'second']);
    await queue.close();
  });

  it('bounds accepted transactions and drains accepted queued work after closing admission', async () => {
    const queue = new SettingsMutationQueue(2);
    const held = deferred();
    const first = queue.run('global', () => held.promise);
    const second = queue.run('global', async () => 'accepted');
    await expect(queue.run('other', async () => undefined)).rejects.toMatchObject({
      statusCode: 503,
    });
    const close = queue.close();
    expect(queue.close()).toBe(close);
    await expect(queue.run('new', async () => undefined)).rejects.toMatchObject({
      statusCode: 503,
    });
    let closed = false;
    void close.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    held.resolve();
    await first;
    expect(await second).toBe('accepted');
    await close;
  });

  it('keeps a timeout failure sticky after the underlying operation really settles', async () => {
    const queue = new SettingsMutationQueue(2, 10);
    const held = deferred();
    const operation = queue.run('global', () => held.promise);
    const close = queue.close();
    await expect(close).rejects.toMatchObject({ statusCode: 503 });
    held.resolve();
    await operation;
    expect(queue.close()).toBe(close);
    await expect(queue.close()).rejects.toThrow('cleanup could not be confirmed');
  });

  it('does not poison the queue after a failed transaction', async () => {
    const queue = new SettingsMutationQueue();
    const failure = queue.run('global', async () => {
      throw new Error('fixture');
    });
    const next = queue.run('global', async () => 'recovered');
    await expect(failure).rejects.toThrow('fixture');
    expect(await next).toBe('recovered');
    await queue.close();
  });
});
