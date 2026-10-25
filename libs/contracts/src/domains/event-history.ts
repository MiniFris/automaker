import { z } from 'zod';
import { EntityIdSchema, ProjectPathSchema, UtcDateTimeSchema } from '../common.js';
import type {
  StoredEvent,
  StoredEventSummary,
  EventReplayResult,
  EventReplayHookResult,
  EventHookTrigger,
} from '@automaker/types';

const EventFilterSchema = z
  .object({
    trigger: z.string().trim().min(1).optional(),
    featureId: EntityIdSchema.optional(),
    since: UtcDateTimeSchema.optional(),
    until: UtcDateTimeSchema.optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const EventListRequestSchema = z
  .object({ projectPath: ProjectPathSchema, filter: EventFilterSchema.optional() })
  .strict();
export const EventProjectRequestSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export const EventByIdRequestSchema = z
  .object({ projectPath: ProjectPathSchema, eventId: EntityIdSchema })
  .strict();
export const EventReplayRequestSchema = EventByIdRequestSchema.extend({
  hookIds: z.array(EntityIdSchema).max(100).optional(),
}).strict();

export type EventListRequest = z.infer<typeof EventListRequestSchema>;
export type EventProjectRequest = z.infer<typeof EventProjectRequestSchema>;
export type EventByIdRequest = z.infer<typeof EventByIdRequestSchema>;
export type EventReplayRequest = z.infer<typeof EventReplayRequestSchema>;

type HistoricalOptional<T> = { [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K] };
type HistoricalEvent<T extends { trigger: EventHookTrigger }> = Omit<
  HistoricalOptional<T>,
  'trigger'
> & {
  trigger: EventHookTrigger | (string & {});
};
export const EventSummaryRecordSchema = z
  .object({
    id: z.string(),
    trigger: z.string(),
    timestamp: z.string(),
    featureId: z.string().nullish(),
    featureName: z.string().nullish(),
  })
  .passthrough() satisfies z.ZodType<HistoricalEvent<StoredEventSummary>>;
export const StoredEventRecordSchema = EventSummaryRecordSchema.extend({
  projectPath: z.string(),
  projectName: z.string(),
  error: z.string().nullish(),
  errorType: z.string().nullish(),
  passes: z.boolean().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
}) satisfies z.ZodType<HistoricalEvent<StoredEvent>>;
export const EventReplayHookRecordSchema = z
  .object({
    hookId: z.string(),
    hookName: z.string().nullish(),
    success: z.boolean(),
    error: z.string().nullish(),
    durationMs: z.number().nonnegative(),
  })
  .passthrough() satisfies z.ZodType<HistoricalOptional<EventReplayHookResult>>;
export const EventReplayResultRecordSchema = z
  .object({
    eventId: z.string(),
    hooksTriggered: z.number().int().nonnegative(),
    hookResults: z.array(EventReplayHookRecordSchema),
  })
  .passthrough() satisfies z.ZodType<
  Omit<EventReplayResult, 'hookResults'> & {
    hookResults: HistoricalOptional<EventReplayHookResult>[];
  }
>;
export const EventHistoryListResponseSchema = z
  .object({
    success: z.literal(true),
    events: z.array(EventSummaryRecordSchema),
    total: z.number().int().nonnegative(),
  })
  .passthrough();
export const EventHistoryReadResponseSchema = z
  .object({
    success: z.literal(true),
    event: StoredEventRecordSchema,
  })
  .passthrough();
export const EventHistoryDeleteResponseSchema = z
  .object({ success: z.literal(true) })
  .passthrough();
export const EventHistoryClearResponseSchema = z
  .object({ success: z.literal(true), cleared: z.number().int().nonnegative() })
  .passthrough();
export const EventHistoryReplayResponseSchema = z
  .object({ success: z.literal(true), result: EventReplayResultRecordSchema })
  .passthrough();
export type EventSummaryRecord = z.infer<typeof EventSummaryRecordSchema>;
export type StoredEventRecord = z.infer<typeof StoredEventRecordSchema>;
export type EventHistoryListResponse = z.infer<typeof EventHistoryListResponseSchema>;
export type EventHistoryReadResponse = z.infer<typeof EventHistoryReadResponseSchema>;
export type EventHistoryDeleteResponse = z.infer<typeof EventHistoryDeleteResponseSchema>;
export type EventHistoryClearResponse = z.infer<typeof EventHistoryClearResponseSchema>;
export type EventHistoryReplayResponse = z.infer<typeof EventHistoryReplayResponseSchema>;
