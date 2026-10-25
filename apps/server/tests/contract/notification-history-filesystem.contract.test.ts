import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { NotificationService } from '../../src/services/notification-service.js';
import { EventHistoryService } from '../../src/services/event-history-service.js';
import { EventHookService } from '../../src/services/event-hook-service.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import type { EventEmitter } from '../../src/lib/events.js';
import type { ProjectEventFilesystem } from '../../src/services/project-event-storage.js';
import { getNotificationsPath, getEventHistoryIndexPath, getEventPath } from '@automaker/platform';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-history-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  const results = await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  await fs.rm(root, { recursive: true, force: true });
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function owner(name: string) {
  const project = path.join(root, name);
  await fs.mkdir(project);
  const runtime = await createNestApplication({
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      ALLOWED_ROOT_DIRECTORY: project,
      AUTOMAKER_API_KEY: 'fixture',
    },
  });
  apps.push(runtime);
  return {
    ...runtime,
    project,
    filesystem: runtime.app.get<ProjectEventFilesystem & { close(): Promise<void> }>(
      SECURE_FILESYSTEM
    ),
    notifications: runtime.app.get(NotificationService),
    history: runtime.app.get(EventHistoryService),
  };
}
function notification(projectPath: string, title = 'Owned notification') {
  return { projectPath, title, message: 'Offline fixture', type: 'agent_complete' as const };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('isolates native ports, real files and notification events across two roots and shutdown', async () => {
  const first = await owner('first'),
    second = await owner('second');
  expect((first.notifications as any).storage.filesystem).toBe(first.filesystem);
  expect((first.history as any).storage.filesystem).toBe(first.filesystem);
  const one = vi.fn(),
    two = vi.fn();
  first.app.get<EventEmitter>(APPLICATION_EVENTS).subscribe((type, data) => {
    if (type === 'notification:created') one(data);
  });
  second.app.get<EventEmitter>(APPLICATION_EVENTS).subscribe((type, data) => {
    if (type === 'notification:created') two(data);
  });
  const created = await first.notifications.createNotification(notification(first.project));
  expect(one).toHaveBeenCalledWith(created);
  expect(two).not.toHaveBeenCalled();
  const event = await first.history.storeEvent({
    projectPath: first.project,
    trigger: 'feature_created',
  });
  expect((await first.history.getEvent(first.project, event.id))?.id).toBe(event.id);
  await expect(
    first.notifications.createNotification(notification(second.project))
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    first.history.storeEvent({ projectPath: second.project, trigger: 'feature_success' })
  ).rejects.toMatchObject({ statusCode: 403 });
  await first.app.close();
  expect(await second.notifications.getNotifications(second.project)).toEqual([]);
  expect(await second.history.getEvents(second.project)).toEqual([]);
  await second.notifications.createNotification(notification(second.project));
  await second.history.storeEvent({ projectPath: second.project, trigger: 'feature_created' });
  expect(
    JSON.parse(await fs.readFile(getNotificationsPath(first.project), 'utf8')).notifications
  ).toHaveLength(1);
});

it('preserves every concurrent notification/history mutation within a project', async () => {
  const runtime = await owner('concurrent');
  const notices = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      runtime.notifications.createNotification(notification(runtime.project, `N${index}`))
    )
  );
  await Promise.all(
    notices.map((notice, index) =>
      index % 2
        ? runtime.notifications.markAsRead(runtime.project, notice.id)
        : runtime.notifications.dismissNotification(runtime.project, notice.id)
    )
  );
  const stored = JSON.parse(await fs.readFile(getNotificationsPath(runtime.project), 'utf8'));
  expect(stored.notifications).toHaveLength(20);
  expect(stored.notifications.filter((entry: any) => entry.read)).toHaveLength(10);
  expect(stored.notifications.filter((entry: any) => entry.dismissed)).toHaveLength(10);
  const events = await Promise.all(
    Array.from({ length: 20 }, () =>
      runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_created' })
    )
  );
  await Promise.all(
    events.slice(0, 10).map((event) => runtime.history.deleteEvent(runtime.project, event.id))
  );
  const index = JSON.parse(await fs.readFile(getEventHistoryIndexPath(runtime.project), 'utf8'));
  expect(index.events).toHaveLength(10);
  for (const event of index.events)
    expect((await runtime.history.getEvent(runtime.project, event.id))?.id).toBe(event.id);
});

it('serializes alias and canonical project paths in the same native notification/history lanes', async () => {
  const runtime = await owner('canonical');
  const alias = path.join(root, 'project-alias');
  await fs.symlink(runtime.project, alias, 'dir');
  await runtime.notifications.createNotification(notification(runtime.project, 'Initial'));
  await runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_created' });
  for (const kind of ['notifications', 'history'] as const) {
    const entered = deferred(),
      release = deferred();
    const read = runtime.filesystem.readFile.bind(runtime.filesystem);
    const filename = kind === 'notifications' ? 'notifications.json' : 'index.json';
    let reads = 0;
    const interception = vi
      .spyOn(runtime.filesystem, 'readFile')
      .mockImplementation(async (file, ...args) => {
        const content = await read(file, ...args);
        if (String(file).endsWith('/' + filename)) {
          reads++;
          if (reads === 1) {
            entered.resolve();
            await release.promise;
          }
        }
        return content;
      });
    const create = (project: string) =>
      kind === 'notifications'
        ? runtime.notifications.createNotification(notification(project))
        : runtime.history.storeEvent({ projectPath: project, trigger: 'feature_success' });
    const first = create(runtime.project);
    await entered.promise;
    const others = Array.from({ length: 12 }, (_, index) =>
      create(index % 2 ? runtime.project : alias)
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads).toBe(1);
    release.resolve();
    await Promise.all([first, ...others]);
    interception.mockRestore();
    const entries =
      kind === 'notifications'
        ? await runtime.notifications.getNotifications(alias)
        : await runtime.history.getEvents(alias);
    expect(entries).toHaveLength(14);
  }
});

it.each(['EIO', 'EACCES', 'corrupt', 'shape'])(
  'does not overwrite either store on %s mutation reads',
  async (failure) => {
    const runtime = await owner(failure);
    await runtime.notifications.createNotification(notification(runtime.project));
    await runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_created' });
    const targets = [
      getNotificationsPath(runtime.project),
      getEventHistoryIndexPath(runtime.project),
    ];
    if (failure === 'corrupt' || failure === 'shape')
      for (const file of targets) await fs.writeFile(file, failure === 'corrupt' ? '{' : 'null');
    const bytes = await Promise.all(targets.map((file) => fs.readFile(file, 'utf8')));
    const before = await fs.readdir(path.dirname(targets[1]));
    const read = runtime.filesystem.readFile.bind(runtime.filesystem);
    if (failure === 'EIO' || failure === 'EACCES')
      vi.spyOn(runtime.filesystem, 'readFile').mockImplementation((file, ...args) => {
        if (targets.includes(String(file)))
          return Promise.reject(Object.assign(new Error(failure), { code: failure }));
        return read(file, ...args);
      });
    await expect(
      runtime.notifications.createNotification(notification(runtime.project))
    ).rejects.toThrow();
    await expect(
      runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_success' })
    ).rejects.toThrow();
    expect(await Promise.all(targets.map((file) => fs.readFile(file, 'utf8')))).toEqual(bytes);
    expect(await fs.readdir(path.dirname(targets[1]))).toEqual(before);
  }
);

it('keeps referenced event data on index commit failure and on a reported error after commit', async () => {
  const runtime = await owner('index-error');
  const old = await runtime.history.storeEvent({
    projectPath: runtime.project,
    trigger: 'feature_created',
  });
  const index = getEventHistoryIndexPath(runtime.project);
  const original = await fs.readFile(index, 'utf8');
  const rename = runtime.filesystem.rename.bind(runtime.filesystem);
  let commitBeforeError = false;
  const failing = vi
    .spyOn(runtime.filesystem, 'rename')
    .mockImplementation(async (source, target) => {
      if (target === index) {
        if (commitBeforeError) await rename(source, target);
        throw Object.assign(new Error('index rename'), { code: 'EIO' });
      }
      return rename(source, target);
    });
  await expect(runtime.history.deleteEvent(runtime.project, old.id)).rejects.toMatchObject({
    code: 'EIO',
  });
  await expect(runtime.history.clearEvents(runtime.project)).rejects.toMatchObject({ code: 'EIO' });
  await expect(
    runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_success' })
  ).rejects.toMatchObject({ code: 'EIO' });
  expect(await fs.readFile(index, 'utf8')).toBe(original);
  expect(JSON.parse(await fs.readFile(getEventPath(runtime.project, old.id), 'utf8')).id).toBe(
    old.id
  );
  commitBeforeError = true;
  await expect(
    runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_success' })
  ).rejects.toMatchObject({ code: 'EIO' });
  failing.mockRestore();
  const committed = await runtime.history.getEvents(runtime.project);
  expect(committed).toHaveLength(2);
  for (const event of committed)
    expect((await runtime.history.getEvent(runtime.project, event.id))?.id).toBe(event.id);
});

it('reports failed cleanup and never deletes data still referenced by the committed index', async () => {
  const runtime = await owner('cleanup');
  const event = await runtime.history.storeEvent({
    projectPath: runtime.project,
    trigger: 'feature_created',
  });
  const unlink = runtime.filesystem.unlink.bind(runtime.filesystem);
  vi.spyOn(runtime.filesystem, 'unlink').mockImplementation((file) => {
    if (String(file) === getEventPath(runtime.project, event.id))
      return Promise.reject(Object.assign(new Error('cleanup IO'), { code: 'EIO' }));
    return unlink(file);
  });
  await expect(runtime.history.deleteEvent(runtime.project, event.id)).rejects.toMatchObject({
    code: 'EIO',
  });
  expect(await runtime.history.getEvents(runtime.project)).toEqual([]);
  expect(JSON.parse(await fs.readFile(getEventPath(runtime.project, event.id), 'utf8')).id).toBe(
    event.id
  );
});

it.each(['notifications', 'history'] as const)(
  'drains accepted %s writes after event producers stop and before native FS closes',
  async (kind) => {
    const runtime = await owner(kind);
    const target =
      kind === 'notifications'
        ? getNotificationsPath(runtime.project)
        : getEventHistoryIndexPath(runtime.project);
    const entered = deferred(),
      release = deferred();
    const rename = runtime.filesystem.rename.bind(runtime.filesystem);
    vi.spyOn(runtime.filesystem, 'rename').mockImplementation(async (source, destination) => {
      if (destination === target) {
        entered.resolve();
        await release.promise;
      }
      return rename(source, destination);
    });
    const order: string[] = [];
    const hooks = runtime.app.get(EventHookService),
      destroy = hooks.destroy.bind(hooks);
    vi.spyOn(hooks, 'destroy').mockImplementation(async () => {
      await destroy();
      order.push('producers-stopped');
    });
    const close = runtime.filesystem.close.bind(runtime.filesystem);
    vi.spyOn(runtime.filesystem, 'close').mockImplementation(async () => {
      expect(order).toContain('producers-stopped');
      expect(order).toContain('write-settled');
      return close();
    });
    const service = kind === 'notifications' ? runtime.notifications : runtime.history;
    const writing = (
      kind === 'notifications'
        ? runtime.notifications.createNotification(notification(runtime.project))
        : runtime.history.storeEvent({ projectPath: runtime.project, trigger: 'feature_created' })
    ).then(() => {
      order.push('write-settled');
    });
    await entered.promise;
    let closed = false;
    const closing = runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect((service as any).storage.closing).toBeDefined());
    expect(closed).toBe(false);
    await expect(
      kind === 'notifications'
        ? runtime.notifications.getNotifications(runtime.project)
        : runtime.history.getEvents(runtime.project)
    ).rejects.toMatchObject({ statusCode: 503 });
    release.resolve();
    await writing;
    await closing;
    expect(JSON.parse(await fs.readFile(target, 'utf8')).version).toBe(1);
  }
);
