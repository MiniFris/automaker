import { z } from 'zod';
import { EntityIdSchema, ProjectPathSchema } from '@automaker/contracts';

export const NotificationProjectRequestSchema = z
  .object({ projectPath: ProjectPathSchema })
  .strict();
export const NotificationMutationRequestSchema = z
  .object({ projectPath: ProjectPathSchema, notificationId: EntityIdSchema.optional() })
  .strict();

export type NotificationProjectRequest = z.infer<typeof NotificationProjectRequestSchema>;
export type NotificationMutationRequest = z.infer<typeof NotificationMutationRequestSchema>;
