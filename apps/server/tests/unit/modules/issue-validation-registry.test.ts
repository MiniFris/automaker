import { afterEach, expect, it, vi } from 'vitest';
import { IssueValidationRegistry } from '../../../src/modules/github/issue-validation-registry.service.js';
import { ProviderCleanupError } from '../../../src/providers/provider-execution-scope.js';

const registries: IssueValidationRegistry[] = [];
const registry = () => {
  const owner = new IssueValidationRegistry();
  registries.push(owner);
  return owner;
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  await Promise.all(registries.splice(0).map((owner) => owner.onModuleDestroy().catch(() => {})));
  vi.useRealTimers();
});

it('claims synchronously and isolates applications and exact project keys', async () => {
  const first = registry(),
    second = registry(),
    gate = deferred();
  expect(first.start('/project||one', 12, () => gate.promise)).toBe(true);
  expect(first.start('/project||one', 12, () => gate.promise)).toBe(false);
  expect(first.start('/project', 12, () => gate.promise)).toBe(true);
  expect(second.start('/project||one', 12, () => gate.promise)).toBe(true);
  expect(first.running('/project')).toEqual([12]);
  expect(first.running('/project||one')).toEqual([12]);
  gate.resolve();
  await vi.waitFor(() => expect(first.status('/project', 12)).toBeNull());
});

it('retains a cancelled slot until actual work settles and never lets an older task release a newer claim', async () => {
  const owner = registry(),
    gate = deferred();
  let signal: AbortSignal | undefined;
  owner.start('/project', 1, async (controller) => {
    signal = controller.signal;
    await gate.promise;
  });
  await vi.waitFor(() => expect(signal).toBeDefined());
  expect(owner.abort('/project', 1)).toBe(true);
  expect(signal!.aborted).toBe(true);
  expect(owner.status('/project', 1)?.isRunning).toBe(true);
  expect(owner.start('/project', 1, async () => {})).toBe(false);
  gate.resolve();
  await vi.waitFor(() => expect(owner.status('/project', 1)).toBeNull());
  const next = deferred();
  owner.start('/project', 1, () => next.promise);
  await Promise.resolve();
  expect(owner.status('/project', 1)?.isRunning).toBe(true);
  next.resolve();
});

it('does not start a queued operation cancelled before its first turn', async () => {
  const owner = registry(),
    work = vi.fn();
  owner.start('/project', 1, work);
  owner.abort('/project', 1);
  await owner.onModuleDestroy();
  expect(work).not.toHaveBeenCalled();
  expect(owner.status('/project', 1)).toBeNull();
});

it('stale cleanup requests cancellation without discarding active ownership', async () => {
  vi.useFakeTimers();
  const owner = registry(),
    gate = deferred();
  owner.onModuleInit();
  owner.onModuleInit();
  const before = Date.now();
  owner.start('/project', 1, () => gate.promise);
  await Promise.resolve();
  vi.setSystemTime(before + 3_600_001);
  expect(owner.cleanupStale()).toBe(1);
  expect(owner.cleanupStale()).toBe(0);
  expect(owner.running('/project')).toEqual([1]);
  const closing = owner.onModuleDestroy();
  gate.resolve();
  await closing;
  expect(vi.getTimerCount()).toBe(0);
});

it('owns the six-minute operation deadline without claiming that timeout confirmed exit', async () => {
  vi.useFakeTimers();
  const owner = registry(),
    gate = deferred();
  let signal: AbortSignal | undefined;
  owner.start('/project', 1, async (controller) => {
    signal = controller.signal;
    await gate.promise;
  });
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(360_000);
  expect(signal!.aborted).toBe(true);
  expect(owner.running('/project')).toEqual([1]);
  gate.resolve();
  await owner.onModuleDestroy();
  expect(vi.getTimerCount()).toBe(0);
});

it('awaits active work, shares close outcome and rejects admission after shutdown begins', async () => {
  const owner = registry(),
    gate = deferred();
  owner.start('/project', 1, () => gate.promise);
  await Promise.resolve();
  const closing = owner.onModuleDestroy();
  expect(owner.onModuleDestroy()).toBe(closing);
  expect(() => owner.start('/project', 2, async () => {})).toThrow('shutting down');
  let complete = false;
  void closing.then(() => {
    complete = true;
  });
  await Promise.resolve();
  expect(complete).toBe(false);
  gate.resolve();
  await closing;
});

it('retains an unconfirmed provider identity and reports static failed shutdown', async () => {
  const owner = registry();
  owner.start('/project', 1, async () => {
    throw new ProviderCleanupError();
  });
  await vi.waitFor(() => expect(owner.hasUnconfirmed('/project', 1)).toBe(true));
  expect(owner.status('/project', 1)?.isRunning).toBe(true);
  expect(owner.hasUnconfirmed('/project', 1)).toBe(true);
  expect(() => owner.start('/project', 1, async () => {})).toThrow('cleanup is unconfirmed');
  const closing = owner.onModuleDestroy();
  await expect(closing).rejects.toMatchObject({ code: 'ISSUE_VALIDATION_CLEANUP_FAILED' });
  expect(owner.onModuleDestroy()).toBe(closing);
});

it('bounds an uninterruptible task drain and does not turn a late settlement into successful close', async () => {
  vi.useFakeTimers();
  const owner = registry(),
    gate = deferred();
  owner.start('/project', 1, () => gate.promise);
  await Promise.resolve();
  const closing = owner.onModuleDestroy();
  const rejected = expect(closing).rejects.toMatchObject({
    code: 'ISSUE_VALIDATION_CLEANUP_FAILED',
  });
  await vi.advanceTimersByTimeAsync(25_000);
  await rejected;
  expect(owner.status('/project', 1)?.isRunning).toBe(true);
  gate.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(owner.onModuleDestroy()).toBe(closing);
});
