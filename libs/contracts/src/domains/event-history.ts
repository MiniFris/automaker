import { z } from 'zod';
import { EntityIdSchema, ProjectPathSchema } from '../common.js';

const EventFilterSchema = z
  .object({
    trigger: z.string().trim().min(1).optional(),
    featureId: EntityIdSchema.optional(),
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
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
