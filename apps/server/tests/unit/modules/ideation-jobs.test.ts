import { afterEach, expect, it, vi } from 'vitest';
import { IdeationJobs } from '../../../src/modules/ideation/ideation-jobs.js';

afterEach(() => vi.useRealTimers());
it('fails close and further admission after an explicit unknown cleanup outcome', async () => {
  const jobs = new IdeationJobs();
  await expect(
    jobs.run(async () => {
      throw Object.assign(new Error('owned fixture'), { code: 'PROVIDER_CLEANUP_FAILED' });
    })
  ).rejects.toMatchObject({ code: 'PROVIDER_CLEANUP_FAILED' });
  expect(() => jobs.run(async () => {})).toThrow('could not be confirmed');
  await expect(jobs.close()).rejects.toMatchObject({ code: 'IDEATION_CLEANUP_FAILED' });
});
it('bounds accepted work, aborts it and drains actual completion', async () => {
  const jobs = new IdeationJobs();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const signals: AbortSignal[] = [];
  const accepted = Array.from({ length: 64 }, () =>
    jobs.run(async (controller) => {
      signals.push(controller.signal);
      await held;
    })
  );
  expect(() => jobs.run(async () => {})).toThrow('busy');
  await Promise.resolve();
  const closing = jobs.close();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(() => jobs.run(async () => {})).toThrow('shutting down');
  finish();
  await Promise.all(accepted);
  await closing;
  expect(jobs.close()).toBe(closing);
});
it('retains a failed cached close when an uncooperative provider exceeds the drain deadline', async () => {
  vi.useFakeTimers();
  const jobs = new IdeationJobs();
  let finish!: () => void;
  const task = jobs.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await Promise.resolve();
  const closing = jobs.close();
  const rejected = expect(closing).rejects.toMatchObject({ code: 'IDEATION_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
  finish();
  await task;
  await expect(jobs.close()).rejects.toMatchObject({ code: 'IDEATION_CLEANUP_FAILED' });
});
