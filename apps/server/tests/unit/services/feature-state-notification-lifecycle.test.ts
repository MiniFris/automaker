import { afterEach, expect, it, vi } from 'vitest';
import { FeatureStateManager } from '../../../src/services/feature-state-manager.js';
import type { FeatureLoader } from '../../../src/services/feature-loader.js';
import type { NotificationService } from '../../../src/services/notification-service.js';
import type { PipelineService } from '../../../src/services/pipeline-service.js';
import { createEventEmitter } from '../../../src/lib/events.js';

const managers: FeatureStateManager[] = [];
const releases: Array<() => void> = [];
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
function fixture(hold = Promise.resolve()) {
  const events = createEventEmitter();
  const subscribe = events.subscribe.bind(events);
  const detach = vi.fn();
  vi.spyOn(events, 'subscribe').mockImplementation((callback) => {
    const unsubscribe = subscribe(callback);
    return () => {
      detach();
      unsubscribe();
    };
  });
  const createNotification = vi.fn(async () => {
    await hold;
    return {} as never;
  });
  const manager = new FeatureStateManager(
    events,
    {} as FeatureLoader,
    { createNotification } as unknown as NotificationService,
    {} as PipelineService
  );
  managers.push(manager);
  return {
    detach,
    manager,
    events,
    createNotification,
    emit: () =>
      events.emit('auto-mode:event', {
        type: 'auto_mode_error',
        projectPath: '/fixture',
        error: 'failure',
      }),
  };
}
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  await Promise.all(managers.splice(0).map((manager) => manager.destroy().catch(() => {})));
  vi.useRealTimers();
});
it('reserves an accepted notification before microtasks and closes admission synchronously', async () => {
  const gate = deferred(),
    owner = fixture(gate.promise);
  owner.emit();
  const close = owner.manager.destroy();
  expect(owner.manager.destroy()).toBe(close);
  expect(owner.detach).toHaveBeenCalledOnce();
  owner.emit();
  await Promise.resolve();
  expect(owner.createNotification).toHaveBeenCalledOnce();
  let closed = false;
  void close.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  gate.release();
  await close;
  owner.emit();
  await Promise.resolve();
  expect(owner.createNotification).toHaveBeenCalledOnce();
});
it('bounds notification jobs without scheduling work for non-error events', async () => {
  const gate = deferred(),
    owner = fixture(gate.promise);
  for (let i = 0; i < 1000; i++) owner.events.emit('auto-mode:event', { type: 'auto_mode_idle' });
  for (let i = 0; i < 257; i++) owner.emit();
  await Promise.resolve();
  expect(owner.createNotification).toHaveBeenCalledTimes(256);
  const close = owner.manager.destroy();
  gate.release();
  await close;
});
it('retains failed close when accepted notification cleanup cannot be confirmed', async () => {
  vi.useFakeTimers();
  const gate = deferred(),
    owner = fixture(gate.promise);
  owner.emit();
  await Promise.resolve();
  const close = owner.manager.destroy();
  const failed = expect(close).rejects.toMatchObject({
    code: 'FEATURE_STATE_NOTIFICATION_CLEANUP_FAILED',
  });
  await vi.advanceTimersByTimeAsync(5000);
  await failed;
  owner.emit();
  gate.release();
  await Promise.resolve();
  await Promise.resolve();
  expect(owner.manager.destroy()).toBe(close);
  await expect(owner.manager.destroy()).rejects.toMatchObject({
    code: 'FEATURE_STATE_NOTIFICATION_CLEANUP_FAILED',
  });
  expect(owner.createNotification).toHaveBeenCalledOnce();
});

it('waits for all accepted jobs before reporting an unexpected subscriber failure', async () => {
  const gate = deferred(),
    owner = fixture();
  const handler = vi
    .spyOn(
      owner.manager as unknown as { handleAutoModeEventError: () => Promise<void> },
      'handleAutoModeEventError'
    )
    .mockRejectedValueOnce(new Error('fixture-unexpected-subscriber-failure'))
    .mockImplementationOnce(() => gate.promise);
  owner.emit();
  owner.emit();
  let settled = false;
  const close = owner.manager.destroy();
  void close.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  const failed = expect(close).rejects.toMatchObject({
    code: 'FEATURE_STATE_NOTIFICATION_CLEANUP_FAILED',
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  gate.release();
  await failed;
});
it('captures accepted event fields before asynchronous handling', async () => {
  const owner = fixture();
  const payload = { type: 'auto_mode_error', projectPath: '/fixture', error: 'original' };
  owner.events.emit('auto-mode:event', payload);
  payload.error = 'mutated-after-emit';
  await owner.manager.destroy();
  expect(owner.createNotification).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'original' })
  );
});

it('retains an unexpected job failure that settled before close', async () => {
  const owner = fixture();
  vi.spyOn(
    owner.manager as unknown as { handleAutoModeEventError: () => Promise<void> },
    'handleAutoModeEventError'
  ).mockRejectedValue(new Error('fixture-unexpected'));
  owner.emit();
  const pending = () =>
    (owner.manager as unknown as { notificationJobs: Set<unknown> }).notificationJobs.size;
  expect(pending()).toBe(1);
  await vi.waitFor(() => expect(pending()).toBe(0));
  await expect(owner.manager.destroy()).rejects.toMatchObject({
    code: 'FEATURE_STATE_NOTIFICATION_CLEANUP_FAILED',
  });
});
