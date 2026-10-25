import { NtfyService } from '../../../src/services/ntfy-service.js';
import { afterEach, expect, it, vi } from 'vitest';
import { EventHookService } from '../../../src/services/event-hook-service.js';
import { LocalExecutionEnvironment } from '../../../src/services/execution-environment/local.js';
import { ExecutionEnvironmentError } from '../../../src/services/execution-environment/runtime.js';
import { ApplicationEventBusAdapter } from '../../../src/core/eventing/application-event-bus.adapter.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import type { SettingsService } from '../../../src/services/settings-service.js';

const services: EventHookService[] = [];
const event = { featureId: 'feature', projectPath: '/owned-fixture' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(hooks: unknown[] = []) {
  const events = new ApplicationEventBusAdapter(createEventEmitter());
  const settings = { getGlobalSettings: vi.fn().mockResolvedValue({ eventHooks: hooks }) };
  const history = { storeEvent: vi.fn().mockResolvedValue({ id: 'history' }) };
  const features = { get: vi.fn().mockResolvedValue({ title: 'Owned feature' }) };
  const service = new EventHookService(new NtfyService());
  service.initialize(events, settings as never, history as never, features as never);
  services.push(service);
  return { service, events, settings, history, features };
}
const httpHook = {
  id: 'http',
  enabled: true,
  trigger: 'feature_created',
  action: { type: 'http', url: 'http://fixture.invalid/' },
};
const pendingCount = (service: EventHookService) =>
  (service as unknown as { pending: Set<unknown> }).pending.size;

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.destroy().catch(() => {})));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('initializes once and removes only owned typed subscriptions on idempotent shutdown', async () => {
  const { service, events, settings, history } = fixture();
  const sibling = vi.fn();
  events.subscribe('feature:created', sibling);
  expect(() => service.initialize(events, settings as unknown as SettingsService)).toThrow(
    'already initialized'
  );
  const closing = service.destroy();
  expect(service.destroy()).toBe(closing);
  await closing;
  events.emit('feature:created', event);
  expect(sibling).toHaveBeenCalledOnce();
  expect(history.storeEvent).not.toHaveBeenCalled();
  expect(() => service.initialize(events, settings as unknown as SettingsService)).toThrow(
    'already initialized'
  );
});

it('tracks the nested status-change handler and waits for an accepted history write before resolving close', async () => {
  const { service, events, history } = fixture([httpHook]);
  const writing = deferred();
  history.storeEvent.mockReturnValue(writing.promise);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  events.emit('auto-mode:event', { ...event, type: 'feature_status_changed', status: 'verified' });
  await vi.waitFor(() => expect(history.storeEvent).toHaveBeenCalledOnce());
  let closed = false;
  const closing = service.destroy().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  events.emit('feature:created', event);
  writing.resolve();
  await closing;
  expect(history.storeEvent).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(pendingCount(service)).toBe(0);
});

it('does not start an action after a feature lookup that settled during shutdown', async () => {
  const { service, events, features, history } = fixture();
  const loading = deferred();
  features.get.mockReturnValue(loading.promise);
  events.emit('feature:completed', event);
  await vi.waitFor(() => expect(features.get).toHaveBeenCalledOnce());
  const closing = service.destroy();
  loading.resolve();
  await closing;
  expect(history.storeEvent).not.toHaveBeenCalled();
});

it('clears the HTTP deadline even when fetch rejects', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new Error('private-http-detail'));
  vi.stubGlobal('fetch', fetch);
  const { service, events } = fixture([httpHook]);
  events.emit('feature:created', event);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(pendingCount(service)).toBe(0));
  expect(vi.getTimerCount()).toBe(0);
  await service.destroy();
  expect(vi.getTimerCount()).toBe(0);
});

it('aborts an active HTTP action before close settles without treating cancellation as feature failure', async () => {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
    );
  });
  vi.stubGlobal('fetch', fetch);
  const { service, events } = fixture([httpHook]);
  events.emit('feature:created', event);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await service.destroy();
  expect(signal!.aborted).toBe(true);
  expect(pendingCount(service)).toBe(0);
});

it.each(['PROCESS_CLEANUP_FAILED', 'SSH_CLEANUP_UNVERIFIED', 'SSH_OUTCOME_UNKNOWN'])(
  'does not hide an uncertain owned command outcome (%s) behind hook failure isolation',
  async (code) => {
    const execute = vi
      .spyOn(LocalExecutionEnvironment.prototype, 'exec')
      .mockRejectedValue(new ExecutionEnvironmentError(code, 'private-cleanup-detail'));
    const { service, events } = fixture([
      {
        id: 'shell',
        enabled: true,
        trigger: 'auto_mode_complete',
        action: { type: 'shell', command: 'fixture-only-never-executed' },
      },
    ]);
    events.emit('auto-mode:event', { type: 'auto_mode_idle' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(pendingCount(service)).toBe(0));
    const closing = service.destroy();
    await expect(closing).rejects.toMatchObject({ code: 'EVENT_HOOK_CLEANUP_FAILED' });
    await expect(closing).rejects.not.toThrow('private-cleanup-detail');
    expect(service.destroy()).toBe(closing);
  }
);

it('keeps an ordinary failed command isolated from application shutdown', async () => {
  const execute = vi
    .spyOn(LocalExecutionEnvironment.prototype, 'exec')
    .mockResolvedValue({ exitCode: 1, output: 'private-command-output', truncated: false });
  const { service, events } = fixture([
    {
      id: 'shell',
      enabled: true,
      trigger: 'auto_mode_complete',
      action: { type: 'shell', command: 'fixture-only-never-executed' },
    },
  ]);
  events.emit('auto-mode:event', { type: 'auto_mode_idle' });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  await service.destroy();
});

it('reports a bounded unknown drain for an uninterruptible storage write and retains the failed close result', async () => {
  const { service, events, history } = fixture();
  const writing = deferred();
  history.storeEvent.mockReturnValue(writing.promise);
  events.emit('feature:created', event);
  await vi.waitFor(() => expect(history.storeEvent).toHaveBeenCalledOnce());
  vi.useFakeTimers();
  const closing = service.destroy();
  const rejected = expect(closing).rejects.toMatchObject({ code: 'EVENT_HOOK_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(25_000);
  await rejected;
  expect(service.destroy()).toBe(closing);
  expect(vi.getTimerCount()).toBe(0);
  writing.resolve();
  await vi.waitFor(() => expect(pendingCount(service)).toBe(0));
});

it('does not suppress completion in another project with the same feature ID', async () => {
  const { service, events, history } = fixture();
  events.emit('feature:completed', event);
  events.emit('auto-mode:event', {
    ...event,
    projectPath: '/another-owned-project',
    type: 'feature_status_changed',
    status: 'verified',
  });
  await vi.waitFor(() => expect(history.storeEvent).toHaveBeenCalledTimes(2));
  await service.destroy();
});
