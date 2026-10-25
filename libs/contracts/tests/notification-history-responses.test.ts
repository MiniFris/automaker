import { expect, it } from 'vitest';
import { z } from 'zod';
import type { Notification, StoredEvent, EventReplayResult } from '@automaker/types';
import {
  NotificationRecordSchema,
  NotificationReadResponseSchema,
  NotificationDismissResponseSchema,
} from '../src/domains/notifications.js';
import {
  StoredEventRecordSchema,
  EventHistoryReplayResponseSchema,
  EventHistoryListResponseSchema,
} from '../src/domains/event-history.js';

it('accepts current domain records and preserves historical nullable/extension values', () => {
  const notification: Notification = {
    id: 'notice',
    type: 'agent_complete',
    title: 'Title',
    message: 'Message',
    createdAt: 'historical timestamp',
    read: false,
    dismissed: false,
    projectPath: '/fixture',
  };
  expect(NotificationRecordSchema.parse(notification)).toEqual(notification);
  const historical = {
    ...notification,
    type: 'custom historical type',
    featureId: null,
    extra: { retained: true },
  };
  expect(NotificationRecordSchema.parse(historical)).toEqual(historical);
  const event: StoredEvent = {
    id: 'event',
    trigger: 'feature_created',
    timestamp: 'historical timestamp',
    projectPath: '/fixture',
    projectName: 'Fixture',
  };
  expect(StoredEventRecordSchema.parse(event)).toEqual(event);
  const legacy = {
    ...event,
    trigger: 'custom historical trigger',
    metadata: null,
    passes: null,
    error: null,
    extra: ['retained'],
  };
  expect(StoredEventRecordSchema.parse(legacy)).toEqual(legacy);
});

it('requires actual notification mutation payloads instead of a success-only envelope', () => {
  for (const schema of [NotificationReadResponseSchema, NotificationDismissResponseSchema]) {
    expect(schema.safeParse({ success: true }).success).toBe(false);
    expect(schema.safeParse({ success: true, count: 'wrong' }).success).toBe(false);
    expect(schema.parse({ success: true, count: 0 })).toEqual({ success: true, count: 0 });
  }
  expect(
    NotificationDismissResponseSchema.safeParse({ success: true, dismissed: false }).success
  ).toBe(false);
});

it('types replay success and failed hook results without losing optional fields', () => {
  const result: EventReplayResult = {
    eventId: 'event',
    hooksTriggered: 1,
    hookResults: [{ hookId: 'hook', success: false, error: 'Fixture error', durationMs: 0 }],
  };
  expect(EventHistoryReplayResponseSchema.parse({ success: true, result })).toEqual({
    success: true,
    result,
  });
  expect(
    EventHistoryReplayResponseSchema.safeParse({
      success: true,
      result: { ...result, hookResults: [{ hookId: 'hook', success: 'wrong', durationMs: 0 }] },
    }).success
  ).toBe(false);
});

it('exports JSON schemas with typed event arrays and concrete nested replay results', () => {
  const list = z.toJSONSchema(EventHistoryListResponseSchema, { io: 'output' });
  const replay = z.toJSONSchema(EventHistoryReplayResponseSchema, { io: 'output' });
  expect(JSON.stringify(list)).toContain('timestamp');
  expect(JSON.stringify(replay)).toContain('hookResults');
  expect(
    EventHistoryListResponseSchema.safeParse({ success: true, events: [{}], total: 1 }).success
  ).toBe(false);
});
