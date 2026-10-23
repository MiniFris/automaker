import { z } from 'zod';

const SessionIdSchema = z.string().trim().min(1);
const OptionalTextSchema = z.string().optional();

export const AgentSessionSchema = z.object({ sessionId: SessionIdSchema }).strict();
export const AgentStartSchema = z
  .object({ sessionId: SessionIdSchema, workingDirectory: OptionalTextSchema })
  .strict();
export const AgentSendSchema = z
  .object({
    sessionId: SessionIdSchema,
    message: z.string().min(1),
    workingDirectory: OptionalTextSchema,
    imagePaths: z.array(z.string()).optional(),
    model: OptionalTextSchema,
    providerId: OptionalTextSchema,
    thinkingLevel: z.enum(['none', 'low', 'medium', 'high', 'ultrathink', 'adaptive']).optional(),
  })
  .strict();
export const AgentModelSchema = z
  .object({ sessionId: SessionIdSchema, model: z.string().min(1), providerId: OptionalTextSchema })
  .strict();
export const AgentQueueAddSchema = AgentSendSchema.omit({ workingDirectory: true });
export const AgentQueueRemoveSchema = z
  .object({ sessionId: SessionIdSchema, promptId: z.string().min(1) })
  .strict();

export type AgentSessionRequest = z.infer<typeof AgentSessionSchema>;
export type AgentStartRequest = z.infer<typeof AgentStartSchema>;
export type AgentSendRequest = z.infer<typeof AgentSendSchema>;
export type AgentModelRequest = z.infer<typeof AgentModelSchema>;
export type AgentQueueAddRequest = z.infer<typeof AgentQueueAddSchema>;
export type AgentQueueRemoveRequest = z.infer<typeof AgentQueueRemoveSchema>;
