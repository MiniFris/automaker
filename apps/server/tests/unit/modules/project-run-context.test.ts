import { afterEach, expect, it, vi } from 'vitest';
import { ProjectRunContextRegistry } from '../../../src/modules/auto-mode/project-run-context.registry.js';
import { ConcurrencyManager } from '../../../src/services/concurrency-manager.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
afterEach(() => vi.useRealTimers());
it('drains awaited verification and preserves its result', async () => {
  const registry = new ProjectRunContextRegistry();
  const pending = gate();
  const accepted = registry.runAwaited('/project', async () => {
    await pending.promise;
    return false;
  });
  await Promise.resolve();
  const closing = registry.onModuleDestroy();
  pending.release();
  expect(await accepted).toBe(false);
  await closing;
});
it('retains cleanup uncertainty as a failed cached close after the awaited request rejects', async () => {
  const registry = new ProjectRunContextRegistry();
  await expect(
    registry.runAwaited('/project', async () => {
      throw Object.assign(new Error('fixture'), { code: 'PROCESS_CLEANUP_FAILED' });
    })
  ).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
  await expect(registry.onModuleDestroy()).rejects.toMatchObject({
    code: 'AUTO_MODE_COMMAND_CLEANUP_FAILED',
  });
  await expect(registry.onModuleDestroy()).rejects.toMatchObject({
    code: 'AUTO_MODE_COMMAND_CLEANUP_FAILED',
  });
});
it('closes admission synchronously before persistence without aborting accepted work', async () => {
  const registry = new ProjectRunContextRegistry();
  const facade = {
    closeAdmission: vi.fn(),
    interruptForShutdown: vi.fn(),
    drainRecoveryState: vi.fn().mockResolvedValue(undefined),
  };
  registry.getOrCreate('/project', () => facade as never);
  registry.stopAdmission();
  expect(facade.closeAdmission).toHaveBeenCalledOnce();
  expect(facade.interruptForShutdown).not.toHaveBeenCalled();
  expect(() => registry.launch('/project', async () => {})).toThrow('shutting down');
  await registry.onModuleDestroy();
  expect(facade.interruptForShutdown).toHaveBeenCalledOnce();
});
it('skips a queued launch if shutdown starts before its microtask', async () => {
  const registry = new ProjectRunContextRegistry(),
    execute = vi.fn();
  registry.launch('/project', execute);
  await registry.onModuleDestroy();
  expect(execute).not.toHaveBeenCalled();
  expect(() => registry.launch('/project', execute)).toThrow('shutting down');
});
it('bounds accepted launches and waits for actual accepted command completion', async () => {
  const registry = new ProjectRunContextRegistry(),
    pending = gate();
  for (let index = 0; index < 256; index++) registry.launch('/project', () => pending.promise);
  await Promise.resolve();
  expect(() => registry.launch('/project', async () => {})).toThrow('busy');
  const closing = registry.onModuleDestroy();
  pending.release();
  await closing;
  expect(registry.onModuleDestroy()).toBe(closing);
});
it('retains an uncertain command and a failed close after the drain deadline', async () => {
  vi.useFakeTimers();
  const registry = new ProjectRunContextRegistry(),
    pending = gate();
  registry.launch('/project', () => pending.promise);
  await Promise.resolve();
  const closing = registry.onModuleDestroy(),
    refused = expect(closing).rejects.toMatchObject({ code: 'AUTO_MODE_COMMAND_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(5000);
  await refused;
  expect((registry as unknown as { pendingCount: number }).pendingCount).toBe(1);
  pending.release();
  await Promise.resolve();
  await expect(registry.onModuleDestroy()).rejects.toMatchObject({
    code: 'AUTO_MODE_COMMAND_CLEANUP_FAILED',
  });
});
it('closes the actual feature lease admission without adding a second execution registry', () => {
  const leases = new ConcurrencyManager();
  const running = leases.acquire({ projectPath: '/project', featureId: 'one', isAutoMode: false });
  leases.stopAdmission();
  expect(() =>
    leases.acquire({ projectPath: '/project', featureId: 'two', isAutoMode: false })
  ).toThrow('shutting down');
  expect(() =>
    leases.acquire({
      projectPath: '/project',
      featureId: 'one',
      isAutoMode: false,
      allowReuse: true,
    })
  ).toThrow('shutting down');
  expect(leases.getRunningFeature('one')).toBe(running);
});
