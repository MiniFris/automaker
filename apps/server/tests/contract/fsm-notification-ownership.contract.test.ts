import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import { createEventEmitter, type EventEmitter } from '../../src/lib/events.js';
import { AutoModeServiceFacade } from '../../src/services/auto-mode/facade.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { NotificationService } from '../../src/services/notification-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import type { FeatureStateManager } from '../../src/services/feature-state-manager.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';

const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
const releases: Array<() => void> = [];
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  await Promise.all(owners.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fsm-notification-repro-'));
  roots.push(root);
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: root, LOG_LEVEL: 'error' },
  });
  owners.push(owner);
  return {
    ...owner,
    root,
    events: owner.app.get<EventEmitter>(APPLICATION_EVENTS),
    notifications: owner.app.get(NotificationService),
  };
}
it('shares one application FSM across project facades and publishes one durable notification per event', async () => {
  const owner = await fixture();
  for (const name of ['one', 'two']) {
    const project = path.join(owner.root, name);
    await mkdir(project);
    const autoMode = owner.app.get(AutoModeServiceCompat);
    const facade = autoMode.createFacade(project);
    expect(
      (facade as unknown as { featureStateManager: FeatureStateManager }).featureStateManager
    ).toBe(autoMode.getGlobalService().getSharedServices().featureStateManager);
  }
  owner.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: owner.root,
    error: 'one-error',
  });
  await vi.waitFor(async () =>
    expect(await owner.notifications.getNotifications(owner.root)).toHaveLength(1)
  );
  const saved = JSON.parse(
    await readFile(path.join(owner.root, '.automaker/notifications.json'), 'utf8')
  );
  expect(saved.notifications.map((item: { message: string }) => item.message)).toEqual([
    'one-error',
  ]);
});
it('drains an already admitted real notification file write before successful close', async () => {
  const owner = await fixture();
  const filesystem = owner.app.get<typeof Filesystem>(SECURE_FILESYSTEM);
  const write = filesystem.writeFile.bind(filesystem);
  const gate = deferred();
  let held = false;
  vi.spyOn(filesystem, 'writeFile').mockImplementation(async (...args) => {
    if (String(args[0]).includes('notifications.json.write.')) {
      held = true;
      await gate.promise;
    }
    return write(...args);
  });
  owner.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: owner.root,
    error: 'held-write',
  });
  await vi.waitFor(() => expect(held).toBe(true));
  let closed = false;
  const closing = owner.app.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(closed).toBe(false);
  gate.release();
  await closing;
  expect(
    JSON.parse(await readFile(path.join(owner.root, '.automaker/notifications.json'), 'utf8'))
      .notifications
  ).toHaveLength(1);
});
it('drains accepted pre-storage feature lookup before closing notification storage', async () => {
  const owner = await fixture();
  const loader = owner.app.get(FeatureLoader);
  await loader.create(owner.root, {
    id: 'held',
    title: 'Held title',
    description: 'fixture',
    status: 'backlog',
  });
  const gate = deferred();
  const state = (
    owner.app.get(AutoModeServiceCompat).getGlobalService() as unknown as {
      featureStateManager: FeatureStateManager;
    }
  ).featureStateManager;
  const loadFeature = state.loadFeature.bind(state);
  const lookup = vi.spyOn(state, 'loadFeature').mockImplementation(async (...args) => {
    await gate.promise;
    return loadFeature(...args);
  });
  const notify = vi.spyOn(owner.notifications, 'createNotification');
  owner.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: owner.root,
    featureId: 'held',
    error: 'held-lookup',
  });
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  let closed = false;
  const closing = owner.app.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(closed).toBe(false);
  expect(notify).not.toHaveBeenCalled();
  gate.release();
  await closing;
  expect(notify).toHaveBeenCalledOnce();
  await expect(notify.mock.results[0].value).resolves.toMatchObject({ title: 'Held title' });
  expect(
    JSON.parse(await readFile(path.join(owner.root, '.automaker/notifications.json'), 'utf8'))
      .notifications
  ).toHaveLength(1);
});

it('detaches a closing application subscriber while another application continues to publish', async () => {
  const one = await fixture(),
    two = await fixture();
  const first = vi.spyOn(one.notifications, 'createNotification');
  const second = vi.spyOn(two.notifications, 'createNotification');
  await one.app.close();
  one.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: one.root,
    error: 'late',
  });
  two.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: two.root,
    error: 'active',
  });
  await vi.waitFor(async () =>
    expect(await two.notifications.getNotifications(two.root)).toHaveLength(1)
  );
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

it('preserves handled notification failures and still detaches the native subscriber on close', async () => {
  const owner = await fixture();
  const notify = vi
    .spyOn(owner.notifications, 'createNotification')
    .mockRejectedValue(new Error('fixture-known-write-failure'));
  owner.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: owner.root,
    error: 'failed-notify',
  });
  await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
  await expect(owner.app.close()).resolves.toBeUndefined();
  owner.events.emit('auto-mode:event', {
    type: 'auto_mode_error',
    projectPath: owner.root,
    error: 'late',
  });
  await Promise.resolve();
  expect(notify).toHaveBeenCalledOnce();
});

it('explicitly closes a standalone facade owned FSM without closing the native application owner', async () => {
  const owner = await fixture();
  const events = createEventEmitter();
  const loader = owner.app.get(FeatureLoader);
  await loader.create(owner.root, {
    id: 'standalone',
    title: 'Standalone title',
    description: 'fixture',
    status: 'backlog',
  });
  const facade = AutoModeServiceFacade.create(owner.root, {
    events,
    settingsService: owner.app.get(SettingsService),
    featureLoader: loader,
    notificationService: owner.notifications,
    providerRegistry: owner.app.get(ProviderRegistry),
    pipeline: owner.app.get(PipelineService),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
    hostEnvironment: { PATH: '/usr/bin:/bin' },
  });
  const state = (facade as unknown as { featureStateManager: FeatureStateManager })
    .featureStateManager;
  const loadFeature = state.loadFeature.bind(state);
  const gate = deferred();
  const lookup = vi.spyOn(state, 'loadFeature').mockImplementation(async (...args) => {
    await gate.promise;
    return loadFeature(...args);
  });
  try {
    events.emit('auto-mode:event', {
      type: 'auto_mode_error',
      projectPath: owner.root,
      featureId: 'standalone',
      error: 'standalone-error',
    });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    let closed = false;
    const closing = facade.onModuleDestroy().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(closed).toBe(false);
    gate.release();
    await closing;
    events.emit('auto-mode:event', {
      type: 'auto_mode_error',
      projectPath: owner.root,
      error: 'late',
    });
    owner.events.emit('auto-mode:event', {
      type: 'auto_mode_error',
      projectPath: owner.root,
      error: 'native-active',
    });
    await vi.waitFor(async () =>
      expect(await owner.notifications.getNotifications(owner.root)).toHaveLength(2)
    );
    expect(lookup).toHaveBeenCalledOnce();
    expect(
      (await owner.notifications.getNotifications(owner.root)).map((item) => item.message).sort()
    ).toEqual(['Auto Mode Error: standalone-error', 'native-active']);
  } finally {
    gate.release();
    await facade.onModuleDestroy();
  }
});
