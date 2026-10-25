import { z } from 'zod';
import { ProjectPathSchema } from './common.js';

// Catalog membership is validated by the server's application-owned model map.
export const CursorModelSelectionSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^cursor-[A-Za-z0-9._-]+$/);
export const CursorModelConfigSchema = z
  .object({
    defaultModel: z.string().max(256).optional(),
    models: z.array(z.string().max(256)).max(256).optional(),
    mcpServers: z.array(z.string().max(32768)).max(256).optional(),
    rules: z.array(z.string().max(32768)).max(256).optional(),
  })
  .passthrough();
export const CursorModelConfigTargetSchema = z
  .object({
    kind: z.literal('host-cursor-model-config'),
    provider: z.literal('cursor'),
    scope: z.literal('project'),
    instanceId: z.string().uuid(),
    workingDirectory: ProjectPathSchema,
    projectPath: ProjectPathSchema,
    configPath: ProjectPathSchema,
  })
  .strict();
export const CursorModelConfigTargetResponseSchema = z
  .object({
    success: z.literal(true),
    protocolVersion: z.literal(1),
    target: CursorModelConfigTargetSchema,
  })
  .strict();
export const CursorDefaultModelRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: CursorModelConfigTargetSchema,
    model: CursorModelSelectionSchema,
  })
  .strict();
export const CursorEnabledModelsRequestSchema = z
  .object({
    confirmed: z.literal(true),
    target: CursorModelConfigTargetSchema,
    models: z.array(CursorModelSelectionSchema).min(1).max(256),
  })
  .strict();
export const CursorDefaultModelResponseSchema = z
  .object({
    success: z.literal(true),
    target: CursorModelConfigTargetSchema,
    model: CursorModelSelectionSchema,
  })
  .strict();
export const CursorEnabledModelsResponseSchema = z
  .object({
    success: z.literal(true),
    target: CursorModelConfigTargetSchema,
    models: z.array(CursorModelSelectionSchema).min(1).max(256),
  })
  .strict();
export const CursorModelConfigResponseSchema = z
  .object({
    success: z.literal(true),
    target: CursorModelConfigTargetSchema,
    config: CursorModelConfigSchema,
    availableModels: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          description: z.string(),
          hasThinking: z.boolean(),
          supportsVision: z.boolean(),
        })
        .passthrough()
    ),
  })
  .strict();
export type CursorModelConfigTarget = z.infer<typeof CursorModelConfigTargetSchema>;
export type CursorDefaultModelRequest = z.infer<typeof CursorDefaultModelRequestSchema>;
export type CursorEnabledModelsRequest = z.infer<typeof CursorEnabledModelsRequestSchema>;
