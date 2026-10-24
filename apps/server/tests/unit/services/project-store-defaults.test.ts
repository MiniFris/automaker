import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_NOTIFICATIONS_FILE, DEFAULT_EVENT_HISTORY_INDEX } from '@automaker/types';
import { getNotificationsPath, getEventHistoryIndexPath } from '@automaker/platform';
import { NotificationService } from '../../../src/services/notification-service.js';
import { EventHistoryService } from '../../../src/services/event-history-service.js';

it.each([false, true])(
  'never shares project notification defaults (malformed=%s)',
  async (malformed) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-notification-default-'));
    try {
      const first = new NotificationService(),
        second = new NotificationService();
      const one = path.join(directory, 'one'),
        two = path.join(directory, 'two');
      if (malformed) {
        const file = getNotificationsPath(two);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, '{');
      }
      const notification = await first.createNotification({
        projectPath: one,
        type: 'agent_complete',
        title: 'one',
        message: 'owned fixture',
      });
      expect(await second.getNotifications(two)).toEqual([]);
      expect(DEFAULT_NOTIFICATIONS_FILE.notifications).toEqual([]);
      const other = await second.createNotification({
        projectPath: two,
        type: 'agent_complete',
        title: 'two',
        message: 'owned fixture',
      });
      expect((await first.getNotifications(one)).map(({ id }) => id)).toEqual([notification.id]);
      expect((await second.getNotifications(two)).map(({ id }) => id)).toEqual([other.id]);
      expect(DEFAULT_NOTIFICATIONS_FILE.notifications).toEqual([]);
      expect(await first.getNotifications(path.join(directory, 'three'))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it.each([false, true])(
  'never shares project event summary defaults (malformed=%s)',
  async (malformed) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-event-default-'));
    try {
      const first = new EventHistoryService(),
        second = new EventHistoryService();
      const one = path.join(directory, 'one'),
        two = path.join(directory, 'two');
      if (malformed) {
        const file = getEventHistoryIndexPath(two);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, '{');
      }
      const event = await first.storeEvent({ projectPath: one, trigger: 'feature_created' });
      expect(await second.getEvents(two)).toEqual([]);
      expect(DEFAULT_EVENT_HISTORY_INDEX.events).toEqual([]);
      const other = await second.storeEvent({ projectPath: two, trigger: 'feature_success' });
      expect((await first.getEvents(one)).map(({ id }) => id)).toEqual([event.id]);
      expect((await second.getEvents(two)).map(({ id }) => id)).toEqual([other.id]);
      expect(DEFAULT_EVENT_HISTORY_INDEX.events).toEqual([]);
      expect(await first.getEvents(path.join(directory, 'three'))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
