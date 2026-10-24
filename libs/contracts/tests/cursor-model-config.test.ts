import { expect, it } from 'vitest';
import {
  CursorDefaultModelRequestSchema,
  CursorEnabledModelsRequestSchema,
  CursorModelConfigResponseSchema,
  CursorModelConfigTargetResponseSchema,
} from '../src/index.js';
const target = {
  kind: 'host-cursor-model-config',
  provider: 'cursor',
  scope: 'project',
  projectPath: '/project',
  configPath: '/project/.automaker/cursor-config.json',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
};
it('requires a versioned preview and preserves actual catalog metadata/unknown config fields', () => {
  expect(
    CursorModelConfigTargetResponseSchema.parse({ success: true, protocolVersion: 1, target })
      .target
  ).toEqual(target);
  expect(CursorModelConfigTargetResponseSchema.safeParse({ success: true, target }).success).toBe(
    false
  );
  const config = { defaultModel: 'legacy-auto', future: { keep: true } };
  const model = {
    id: 'cursor-auto',
    label: 'Auto',
    description: 'Auto',
    hasThinking: false,
    supportsVision: false,
  };
  expect(
    CursorModelConfigResponseSchema.parse({
      success: true,
      target,
      config,
      availableModels: [model],
    })
  ).toMatchObject({ config, availableModels: [model] });
});
it.each([
  {},
  { confirmed: false, target, model: 'cursor-auto' },
  { confirmed: true, target, model: '__proto__' },
  { confirmed: true, target: { ...target, kind: 'host-cursor-permissions' }, model: 'cursor-auto' },
  { confirmed: true, target, model: 'cursor-auto', projectPath: '/other' },
])('rejects ambiguous model confirmation: %s', (request) => {
  expect(CursorDefaultModelRequestSchema.safeParse(request).success).toBe(false);
});
it.each([[], ['constructor'], [4]])('rejects empty/non-model lists: %s', (models) => {
  expect(
    CursorEnabledModelsRequestSchema.safeParse({ confirmed: true, target, models }).success
  ).toBe(false);
});
