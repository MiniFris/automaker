import { z } from 'zod';
import { SessionIdSchema } from '../project-domain.js';
import { SessionMessageResponseSchema } from '../session-responses.js';

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

// Agent stores accept historical optional values and extension fields without rewriting them.
export const AgentMessageResponseSchema = SessionMessageResponseSchema.extend({
  images: z
    .array(z.object({ data: z.string(), mimeType: z.string(), filename: z.string() }).passthrough())
    .nullish(),
  isError: z.boolean().nullish(),
  deliveryId: z.string().nullish(),
  queuedPromptId: z.string().nullish(),
  deliveryStatus: z.string().nullish(),
  runId: z.string().nullish(),
  executionStatus: z.string().nullish(),
});
export const AgentQueuedPromptResponseSchema = z
  .object({
    id: z.string(),
    message: z.string(),
    addedAt: z.string(),
    imagePaths: z.array(z.string()).nullish(),
    model: z.string().nullish(),
    providerId: z.string().nullish(),
    thinkingLevel: z.string().nullish(),
    deliveryId: z.string().nullish(),
    deliveryStatus: z.string().nullish(),
  })
  .passthrough();
export const AgentOperationFailureResponseSchema = z
  .object({ success: z.literal(false), error: z.string() })
  .passthrough();
export const AgentStartResponseSchema = z
  .object({
    success: z.literal(true),
    sessionId: z.string(),
    messages: z.array(AgentMessageResponseSchema),
  })
  .passthrough();
export const AgentSendResponseSchema = z
  .object({ success: z.literal(true), message: z.string() })
  .passthrough();
export const AgentHistoryResponseSchema = z.union([
  z
    .object({
      success: z.literal(true),
      messages: z.array(AgentMessageResponseSchema),
      isRunning: z.boolean(),
    })
    .passthrough(),
  AgentOperationFailureResponseSchema,
]);
export const AgentMutationResponseSchema = z.union([
  z.object({ success: z.literal(true) }).passthrough(),
  AgentOperationFailureResponseSchema,
]);
export const AgentClearResponseSchema = z.object({ success: z.literal(true) }).passthrough();
// A missing session intentionally returns {success:false} without an error from model().
export const AgentModelResponseSchema = z.object({ success: z.boolean() }).passthrough();
export const AgentQueueAddResponseSchema = z.union([
  z
    .object({ success: z.literal(true), queuedPrompt: AgentQueuedPromptResponseSchema })
    .passthrough(),
  AgentOperationFailureResponseSchema,
]);
export const AgentQueueListResponseSchema = z.union([
  z
    .object({ success: z.literal(true), queue: z.array(AgentQueuedPromptResponseSchema) })
    .passthrough(),
  AgentOperationFailureResponseSchema,
]);
export type AgentMessageResponse = z.infer<typeof AgentMessageResponseSchema>;
export type AgentQueuedPromptResponse = z.infer<typeof AgentQueuedPromptResponseSchema>;
export type AgentStartResponse = z.infer<typeof AgentStartResponseSchema>;
export type AgentSendResponse = z.infer<typeof AgentSendResponseSchema>;
export type AgentHistoryResponse = z.infer<typeof AgentHistoryResponseSchema>;
export type AgentMutationResponse = z.infer<typeof AgentMutationResponseSchema>;
export type AgentClearResponse = z.infer<typeof AgentClearResponseSchema>;
export type AgentModelResponse = z.infer<typeof AgentModelResponseSchema>;
export type AgentQueueAddResponse = z.infer<typeof AgentQueueAddResponseSchema>;
export type AgentQueueListResponse = z.infer<typeof AgentQueueListResponseSchema>;
