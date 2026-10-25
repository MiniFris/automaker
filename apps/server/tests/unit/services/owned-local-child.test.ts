import { EventEmitter } from 'node:events';
import { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createOwnedLocalChild } from '../../../src/services/owned-local-child.js';
import type { OwnedLocalChildTarget } from '../../../src/core/platform/owned-local-child.runtime.js';

afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides: Partial<OwnedLocalChildTarget> = {}) {
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  }) as unknown as ChildProcess;
  const quiescence = deferred();
  const target = {
    prepare: vi.fn(async () => {}),
    signal: vi.fn(),
    waitForQuiescence: vi.fn(() => quiescence.promise),
    ...overrides,
  };
  const owner = createOwnedLocalChild(child, {
    runtime: { capture: () => target },
    cleanupTimeoutMs: 100,
    termGraceMs: 20,
  });
  return { owner, child, target, quiescence };
}
it('does not finish on root exit and escalates before completing the original group', async () => {
  vi.useFakeTimers();
  const { owner, child, target, quiescence } = fixture();
  await owner.ready();
  let completed = false;
  void owner.completion().then(() => {
    completed = true;
  });
  child.emit('exit', 0, null);
  const close = owner.close();
  expect(owner.close()).toBe(close);
  await vi.advanceTimersByTimeAsync(20);
  expect(target.signal).toHaveBeenNthCalledWith(1, 'SIGTERM');
  expect(target.signal).toHaveBeenNthCalledWith(2, 'SIGKILL');
  expect(completed).toBe(false);
  quiescence.resolve();
  await close;
  await owner.completion();
  expect(completed).toBe(true);
  expect(child.kill).not.toHaveBeenCalled();
});
it('retains timed-out close and completion after late root/group exit', async () => {
  vi.useFakeTimers();
  const { owner, child, quiescence } = fixture();
  const close = owner.close();
  const rejected = expect(close).rejects.toMatchObject({
    code: 'LOCAL_PROCESS_CLEANUP_FAILED',
    statusCode: 503,
  });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  child.emit('exit', 0, null);
  quiescence.resolve();
  expect(owner.close()).toBe(close);
  await expect(owner.completion()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
});
it('never signals after a preparation timeout, including late observer completion', async () => {
  vi.useFakeTimers();
  const held = deferred();
  const { owner, child, target } = fixture({ prepare: () => held.promise });
  const rejected = expect(owner.close()).rejects.toMatchObject({
    code: 'LOCAL_PROCESS_CLEANUP_FAILED',
  });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  held.resolve();
  child.emit('exit', 0, null);
  await Promise.resolve();
  await Promise.resolve();
  expect(target.signal).not.toHaveBeenCalled();
});
it('retains an unknown observation instead of treating root exit as cleanup proof', async () => {
  const { owner, child } = fixture({
    waitForQuiescence: async () => {
      throw new Error('private observer failure');
    },
  });
  child.emit('exit', 0, null);
  await expect(owner.completion()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  await expect(owner.close()).rejects.toThrow('Identity was retained');
});
it('never falls back to a numeric PID or ChildProcess kill when capture failed', async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
  }) as unknown as ChildProcess;
  const owner = createOwnedLocalChild(child, {
    runtime: {
      capture() {
        throw new Error('private capture failure');
      },
    },
  });
  await expect(owner.ready()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  await expect(owner.close()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  child.emit('error', new Error('A defined PID cannot prove failed creation.'));
  await expect(owner.close()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  expect(child.kill).not.toHaveBeenCalled();
});

it('waits for affirmative failed-spawn proof with no PID, without signalling', async () => {
  const child = new ChildProcess();
  const kill = vi.spyOn(child, 'kill');
  const owner = createOwnedLocalChild(child);
  await expect(owner.ready()).rejects.toThrow();
  let settled = false;
  const closed = owner.close().then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  child.emit(
    'error',
    Object.assign(new Error('Owned missing executable fixture'), { code: 'ENOENT' })
  );
  await closed;
  await owner.completion();
  expect(kill).not.toHaveBeenCalled();
});

it('retains no-PID uncertainty without a final event, even after a late spawn failure', async () => {
  vi.useFakeTimers();
  const child = new ChildProcess();
  const kill = vi.spyOn(child, 'kill');
  const owner = createOwnedLocalChild(child, { cleanupTimeoutMs: 50 });
  await expect(owner.ready()).rejects.toThrow();
  const closed = owner.close();
  const rejected = expect(closed).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(50);
  await rejected;
  child.emit('error', new Error('Late fixture error'));
  expect(owner.close()).toBe(closed);
  await expect(owner.completion()).rejects.toThrow();
  expect(kill).not.toHaveBeenCalled();
});

it('cannot turn an error after a spawn event into affirmative no-resource proof', async () => {
  const child = new ChildProcess();
  const owner = createOwnedLocalChild(child);
  child.emit('spawn');
  child.emit('error', new Error('Owned IPC failure fixture'));
  await expect(owner.ready()).rejects.toThrow();
  await expect(owner.close()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
});
