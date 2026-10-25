import { expect, it } from 'vitest';
import { z } from 'zod';
import { TerminalSessionsResponseSchema } from '../src/domains/terminal-responses.js';
import { AvailableModelsResponseSchema } from '../src/domains/model-responses.js';

it('preserves the existing terminal Date wire format and emits a serializable output schema', () => {
  const createdAt = new Date('2025-01-02T03:04:05Z');
  const input = { success: true, data: [{ id: 'session', cwd: '', shell: '', createdAt }] };
  expect(TerminalSessionsResponseSchema.parse(input)).toEqual({
    success: true,
    data: [{ id: 'session', cwd: '', shell: '', createdAt: createdAt.toISOString() }],
  });
  expect(
    JSON.stringify(z.toJSONSchema(TerminalSessionsResponseSchema, { io: 'output' }))
  ).toContain('"type":"string"');
  expect(
    TerminalSessionsResponseSchema.safeParse({
      success: true,
      data: [{ id: 's', cwd: '', shell: '', createdAt: new Date('invalid') }],
    }).success
  ).toBe(false);
});
it('retains extensible model metadata without replacing required provider model primitives', () => {
  const model = {
    id: 'id',
    name: '',
    modelString: '',
    provider: 'future',
    description: '',
    tier: 'future-tier',
    contextWindow: 0,
    extension: { historical: null },
  };
  expect(AvailableModelsResponseSchema.parse({ success: true, models: [model] }).models).toEqual([
    model,
  ]);
  const historical = { ...model, providerId: null, contextWindow: null, supportsVision: null };
  expect(
    AvailableModelsResponseSchema.parse({ success: true, models: [historical] }).models
  ).toEqual([historical]);
  expect(
    AvailableModelsResponseSchema.safeParse({
      success: true,
      models: [{ ...model, supportsVision: 'invalid' }],
    }).success
  ).toBe(false);
});
