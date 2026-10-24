import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionEnvironment } from '@/services/execution-environment/local.js';

const observer = vi.hoisted(() => ({ wait: vi.fn() }));
vi.mock('@/core/platform/linux-process-group.js', () => ({
  waitForLinuxProcessGroupExit: observer.wait,
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe.skipIf(process.platform !== 'linux')(
  'local cleanup acknowledgement after parent close',
  () => {
    let directory: string;
    let environment: LocalExecutionEnvironment;
    beforeEach(async () => {
      observer.wait.mockReset();
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-local-cleanup-'));
      environment = await LocalExecutionEnvironment.create(directory);
    });
    afterEach(async () => {
      vi.useRealTimers();
      await fs.rm(directory, { recursive: true, force: true });
    });
    it.each([false, true])(
      'holds the command result until group settlement (aborted=%s)',
      async (aborted) => {
        const entered = deferred(),
          release = deferred();
        observer.wait.mockImplementation(async () => {
          entered.resolve();
          await release.promise;
        });
        const controller = new AbortController();
        const operation = environment.exec(aborted ? 'exec sleep 20' : 'exit 0', controller.signal);
        let settled = false;
        const result = operation
          .then(
            (value) => ({ value }),
            (error) => ({ error })
          )
          .finally(() => {
            settled = true;
          });
        if (aborted) controller.abort();
        try {
          await entered.promise;
          await delay(20); // Real shell close can arrive before the held group observation.
          expect(settled).toBe(false);
          release.resolve();
          if (aborted)
            expect(await result).toMatchObject({ error: { code: 'PROCESS_INTERRUPTED' } });
          else expect(await result).toMatchObject({ value: { exitCode: 0 } });
          expect(observer.wait).toHaveBeenCalledTimes(1);
        } finally {
          release.resolve();
          await result;
        }
      }
    );
    it('retains the cleanup watchdog after parent close and aborts the observer on timeout', async () => {
      vi.useFakeTimers();
      const entered = deferred(),
        release = deferred();
      let signal: AbortSignal | undefined;
      observer.wait.mockImplementation(async (_group: number, incoming: AbortSignal) => {
        signal = incoming;
        entered.resolve();
        await release.promise;
      });
      const operation = environment.exec('exit 0', new AbortController().signal);
      const rejected = expect(operation).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
      try {
        await entered.promise;
        await delay(20);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(2000);
        await rejected;
        expect(signal?.aborted).toBe(true);
      } finally {
        release.resolve();
        await rejected;
      }
    });
    it('normalizes observer failures without exposing process metadata', async () => {
      observer.wait.mockRejectedValue(new Error('private-command /private/process'));
      const operation = environment.exec('exit 0', new AbortController().signal);
      await expect(operation).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
      await expect(operation).rejects.not.toThrow('private-command');
    });
    it('does not acknowledge success past the monotonic deadline even if the timer callback is delayed', async () => {
      const entered = deferred(),
        release = deferred();
      const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
      observer.wait.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
      });
      const operation = environment.exec('exit 0', new AbortController().signal);
      const rejected = expect(operation).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
      try {
        await entered.promise;
        await delay(20);
        clock.mockReturnValue(2001);
        release.resolve();
        await rejected;
      } finally {
        release.resolve();
        clock.mockRestore();
        await rejected;
      }
    });
  }
);
