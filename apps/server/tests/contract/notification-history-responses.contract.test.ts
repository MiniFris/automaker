import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { NotificationService } from '../../src/services/notification-service.js';
import { EventHistoryService } from '../../src/services/event-history-service.js';
import { NotificationsApplicationService } from '../../src/modules/notifications/notifications.service.js';
import { EventHistoryApplicationService } from '../../src/modules/event-history/event-history.service.js';
import { EventReplayService } from '../../src/modules/event-history/event-replay.service.js';
import { getNotificationsPath, getEventPath, getEventHistoryIndexPath } from '@automaker/platform';
import {
  NotificationsListResponseSchema,
  NotificationCountResponseSchema,
  NotificationReadResponseSchema,
  NotificationDismissResponseSchema,
} from '@automaker/contracts/domains/notifications';
import {
  EventHistoryListResponseSchema,
  EventHistoryReadResponseSchema,
  EventHistoryDeleteResponseSchema,
  EventHistoryClearResponseSchema,
  EventHistoryReplayResponseSchema,
} from '@automaker/contracts/domains/event-history';

let root: string, project: string, base: string;
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'notification-history-responses-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'response-fixture',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/`;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(route: string, body: unknown, authenticated = true) {
  const response = await fetch(base + route, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-api-key': 'response-fixture' } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

it('validates all notification operations and both mutation variants without losing legacy record fields', async () => {
  const service = runtime.app.get(NotificationService);
  const first = await service.createNotification({
    projectPath: project,
    type: 'agent_complete',
    title: 'First',
    message: 'Fixture',
  });
  await service.createNotification({
    projectPath: project,
    type: 'feature_verified',
    title: 'Second',
    message: 'Fixture',
  });
  const file = getNotificationsPath(project),
    stored = JSON.parse(await fs.readFile(file, 'utf8'));
  Object.assign(stored.notifications[0], {
    type: 'historical_extension_type',
    featureId: null,
    createdAt: 'legacy timestamp',
    extraNotification: { preserved: true },
  });
  await fs.writeFile(file, JSON.stringify(stored));
  const listed = await call('notifications/list', { projectPath: project });
  expect(listed.status).toBe(200);
  expect(
    NotificationsListResponseSchema.parse(listed.body).notifications.find(
      (entry) => entry.id === first.id
    )
  ).toMatchObject({
    type: 'historical_extension_type',
    featureId: null,
    createdAt: 'legacy timestamp',
    extraNotification: { preserved: true },
  });
  expect(
    NotificationCountResponseSchema.parse(
      (await call('notifications/unread-count', { projectPath: project })).body
    ).count
  ).toBe(2);
  expect(
    NotificationReadResponseSchema.parse(
      (await call('notifications/mark-read', { projectPath: project, notificationId: first.id }))
        .body
    )
  ).toMatchObject({ notification: { read: true, extraNotification: { preserved: true } } });
  expect(
    NotificationReadResponseSchema.parse(
      (await call('notifications/mark-read', { projectPath: project })).body
    )
  ).toEqual({ success: true, count: 1 });
  expect(
    NotificationDismissResponseSchema.parse(
      (await call('notifications/dismiss', { projectPath: project, notificationId: first.id })).body
    )
  ).toEqual({ success: true, dismissed: true });
  expect(
    NotificationDismissResponseSchema.parse(
      (await call('notifications/dismiss', { projectPath: project })).body
    )
  ).toEqual({ success: true, count: 1 });
});

it('validates list/get/delete/clear and an actual replay with zero hooks while preserving historical event data', async () => {
  const history = runtime.app.get(EventHistoryService);
  const event = await history.storeEvent({
    projectPath: project,
    trigger: 'feature_created',
    metadata: { nested: ['fixture', null] },
  });
  const record = JSON.parse(await fs.readFile(getEventPath(project, event.id), 'utf8'));
  Object.assign(record, {
    trigger: 'historical_extension_trigger',
    timestamp: 'legacy timestamp',
    featureId: null,
    featureName: null,
    error: null,
    errorType: null,
    passes: null,
    extraEvent: { kept: true },
  });
  await fs.writeFile(getEventPath(project, event.id), JSON.stringify(record));
  const indexFile = getEventHistoryIndexPath(project),
    index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
  Object.assign(index.events[0], {
    trigger: record.trigger,
    timestamp: record.timestamp,
    featureId: null,
    featureName: null,
    extraSummary: ['kept'],
  });
  await fs.writeFile(indexFile, JSON.stringify(index));
  const listed = await call('event-history/list', { projectPath: project });
  expect(listed.status).toBe(200);
  expect(EventHistoryListResponseSchema.parse(listed.body)).toMatchObject({
    total: 1,
    events: [{ trigger: record.trigger, featureId: null, extraSummary: ['kept'] }],
  });
  const read = await call('event-history/get', { projectPath: project, eventId: event.id });
  expect(read.status).toBe(200);
  expect(EventHistoryReadResponseSchema.parse(read.body).event).toMatchObject({
    extraEvent: { kept: true },
    error: null,
    metadata: { nested: ['fixture', null] },
  });
  expect(
    EventHistoryReplayResponseSchema.parse(
      (await call('event-history/replay', { projectPath: project, eventId: event.id })).body
    ).result
  ).toEqual({ eventId: event.id, hooksTriggered: 0, hookResults: [] });
  expect(
    EventHistoryDeleteResponseSchema.parse(
      (await call('event-history/delete', { projectPath: project, eventId: event.id })).body
    )
  ).toEqual({ success: true });
  await history.storeEvent({ projectPath: project, trigger: 'feature_success' });
  expect(
    EventHistoryClearResponseSchema.parse(
      (await call('event-history/clear', { projectPath: project })).body
    )
  ).toEqual({ success: true, cleared: 1 });
});

it('preserves typed replay failure results and optional/null extension fields at the response boundary', async () => {
  const result = {
    success: true,
    extraEnvelope: 'preserved',
    result: {
      eventId: 'fixture',
      hooksTriggered: 1,
      extraReplay: true,
      hookResults: [
        {
          hookId: 'hook',
          hookName: null,
          success: false,
          error: 'Fixture hook failure',
          durationMs: 0,
          extraHook: [1],
        },
      ],
    },
  };
  vi.spyOn(runtime.app.get(EventReplayService), 'replay').mockResolvedValue(result);
  const response = await call('event-history/replay', { projectPath: project, eventId: 'fixture' });
  expect(response.status).toBe(200);
  expect(EventHistoryReplayResponseSchema.parse(response.body)).toEqual(result);
});

const malformed = [
  [
    'notifications/list',
    NotificationsApplicationService,
    'list',
    { success: true, notifications: [{ id: 42 }] },
  ],
  [
    'notifications/unread-count',
    NotificationsApplicationService,
    'unreadCount',
    { success: true, count: 'wrong' },
  ],
  [
    'notifications/mark-read',
    NotificationsApplicationService,
    'markRead',
    { success: true, notification: { id: 42 } },
  ],
  [
    'notifications/dismiss',
    NotificationsApplicationService,
    'dismiss',
    { success: true, dismissed: 'wrong' },
  ],
  [
    'event-history/list',
    EventHistoryApplicationService,
    'list',
    { success: true, events: [{ id: 42 }], total: 0 },
  ],
  [
    'event-history/get',
    EventHistoryApplicationService,
    'get',
    { success: true, event: { id: 42 } },
  ],
  ['event-history/delete', EventHistoryApplicationService, 'delete', { success: 'wrong' }],
  [
    'event-history/clear',
    EventHistoryApplicationService,
    'clear',
    { success: true, cleared: 'wrong' },
  ],
  [
    'event-history/replay',
    EventReplayService,
    'replay',
    {
      success: true,
      result: {
        eventId: 'fixture',
        hooksTriggered: 1,
        hookResults: [{ hookId: 'hook', success: 'wrong' }],
      },
    },
  ],
] as const;
it.each(malformed)(
  'rejects malformed successful output at native HTTP %s',
  async (route, owner, method, output) => {
    const service = runtime.app.get(owner);
    vi.spyOn(service as any, method).mockResolvedValue({
      ...output,
      privateExtension: 'must-not-leak',
    });
    const body =
      route.startsWith('event-history/') && ['get', 'delete', 'replay'].includes(method)
        ? { projectPath: project, eventId: 'fixture' }
        : route.startsWith('notifications/') && ['markRead', 'dismiss'].includes(method)
          ? { projectPath: project, notificationId: 'fixture' }
          : { projectPath: project };
    const response = await call(route, body);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  }
);

it('retains request/auth/not-found error behavior', async () => {
  expect((await call('notifications/list', { projectPath: project }, false)).status).toBe(401);
  expect((await call('event-history/list', { projectPath: 42 })).status).toBe(400);
  expect((await call('event-history/list', { projectPath: path.dirname(root) })).status).toBe(403);
  expect(
    (await call('notifications/mark-read', { projectPath: project, notificationId: 'missing' }))
      .status
  ).toBe(404);
  const missing = await call('event-history/get', { projectPath: project, eventId: 'missing' });
  expect(missing.status).toBe(404);
  expect(missing.body).toMatchObject({ success: false, error: 'Event not found' });
});
