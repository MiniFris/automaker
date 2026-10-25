import { expect, it } from 'vitest';
import { z } from 'zod';
import { DescribeFileResponseSchema, DescribeImageResponseSchema } from '../src/domains/context.js';
import {
  AgentStartResponseSchema,
  AgentSendResponseSchema,
  AgentHistoryResponseSchema,
  AgentMutationResponseSchema,
  AgentClearResponseSchema,
  AgentModelResponseSchema,
  AgentQueueAddResponseSchema,
  AgentQueueListResponseSchema,
} from '../src/domains/agent.js';

it('preserves description text and envelope extensions without adding transformations', () => {
  const value = {
    success: true,
    description: '  # Markdown\n中文 🙂  ',
    extra: { nested: [null, true] },
    historical: null,
  };
  for (const schema of [DescribeFileResponseSchema, DescribeImageResponseSchema]) {
    expect(schema.parse(value)).toEqual(value);
    expect(schema.safeParse({ success: true, description: 42 }).success).toBe(false);
    expect(schema.safeParse({ success: true }).success).toBe(false);
  }
});

it('preserves complete message/queue payloads and nullable historical optional fields', () => {
  const message = {
    id: 'message',
    role: 'assistant',
    content: 'Rich response',
    timestamp: 'legacy time',
    images: [{ data: 'YQ==', mimeType: 'image/png', filename: 'fixture.png', extension: true }],
    isError: null,
    deliveryId: null,
    executionStatus: 'historical-status',
    extension: { nested: null },
  };
  const start = { success: true, sessionId: 'fixture', messages: [message], extension: 'kept' };
  expect(AgentStartResponseSchema.parse(start)).toEqual(start);
  const queuedPrompt = {
    id: 'queued',
    message: 'Follow-up',
    addedAt: 'legacy time',
    imagePaths: null,
    model: null,
    providerId: null,
    thinkingLevel: 'historical-level',
    deliveryStatus: 'interrupted',
    extension: [1],
  };
  expect(AgentQueueAddResponseSchema.parse({ success: true, queuedPrompt })).toEqual({
    success: true,
    queuedPrompt,
  });
  expect(AgentQueueListResponseSchema.parse({ success: true, queue: [queuedPrompt] })).toEqual({
    success: true,
    queue: [queuedPrompt],
  });
  expect(AgentQueueListResponseSchema.safeParse({ success: true, queue: [{}] }).success).toBe(
    false
  );
});

it('keeps operation failure variants and model false-without-error distinct from malformed successes', () => {
  const failed = { success: false, error: 'Session not found', extension: { kept: true } };
  for (const schema of [
    AgentHistoryResponseSchema,
    AgentMutationResponseSchema,
    AgentQueueAddResponseSchema,
    AgentQueueListResponseSchema,
  ]) {
    expect(schema.parse(failed)).toEqual(failed);
    expect(schema.safeParse({ success: false }).success).toBe(false);
  }
  expect(AgentModelResponseSchema.parse({ success: false })).toEqual({ success: false });
  expect(AgentSendResponseSchema.safeParse({ success: true }).success).toBe(false);
  expect(
    AgentHistoryResponseSchema.safeParse({ success: true, messages: [], isRunning: 'wrong' })
      .success
  ).toBe(false);
});

it('exports every context/agent runtime schema as JSON Schema', () => {
  for (const schema of [
    DescribeFileResponseSchema,
    DescribeImageResponseSchema,
    AgentStartResponseSchema,
    AgentSendResponseSchema,
    AgentHistoryResponseSchema,
    AgentMutationResponseSchema,
    AgentClearResponseSchema,
    AgentModelResponseSchema,
    AgentQueueAddResponseSchema,
    AgentQueueListResponseSchema,
  ]) {
    expect(z.toJSONSchema(schema, { io: 'output' })).toBeTypeOf('object');
  }
});
