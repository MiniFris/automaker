import { z } from 'zod';
import { EntityIdSchema, ProjectPathSchema } from '../common.js';
import type { Notification, NotificationType } from '@automaker/types';

export const NotificationProjectRequestSchema = z
  .object({ projectPath: ProjectPathSchema })
  .strict();
export const NotificationMutationRequestSchema = z
  .object({ projectPath: ProjectPathSchema, notificationId: EntityIdSchema.optional() })
  .strict();

export type NotificationProjectRequest = z.infer<typeof NotificationProjectRequestSchema>;
export type NotificationMutationRequest = z.infer<typeof NotificationMutationRequestSchema>;

// Stored optional fields can be null in older clients. Preserve them and extension keys.
type HistoricalNotification = Omit<Notification, 'featureId' | 'type'> & {
  featureId?: string | null;
  type: NotificationType | (string & {});
};
export const NotificationRecordSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    message: z.string(),
    createdAt: z.string(),
    read: z.boolean(),
    dismissed: z.boolean(),
    featureId: z.string().nullish(),
    projectPath: z.string(),
  })
  .passthrough() satisfies z.ZodType<HistoricalNotification>;
export const NotificationsListResponseSchema = z
  .object({
    success: z.literal(true),
    notifications: z.array(NotificationRecordSchema),
  })
  .passthrough();
export const NotificationCountResponseSchema = z
  .object({
    success: z.literal(true),
    count: z.number().int().nonnegative(),
  })
  .passthrough();
export const NotificationReadResponseSchema = z.union([
  z.object({ success: z.literal(true), notification: NotificationRecordSchema }).passthrough(),
  NotificationCountResponseSchema,
]);
export const NotificationDismissResponseSchema = z.union([
  z.object({ success: z.literal(true), dismissed: z.literal(true) }).passthrough(),
  NotificationCountResponseSchema,
]);
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;
export type NotificationsListResponse = z.infer<typeof NotificationsListResponseSchema>;
export type NotificationCountResponse = z.infer<typeof NotificationCountResponseSchema>;
export type NotificationReadResponse = z.infer<typeof NotificationReadResponseSchema>;
export type NotificationDismissResponse = z.infer<typeof NotificationDismissResponseSchema>;
