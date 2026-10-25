import { z } from 'zod';
import { SetupModelRecordSchema } from './setup-responses.js';

// Both catalogs project the same provider model records and retain nullable legacy metadata.
export const PublicModelDefinitionSchema = SetupModelRecordSchema;
export const AvailableModelsResponseSchema = z.looseObject({
  success: z.literal(true),
  models: z.array(PublicModelDefinitionSchema),
});
export const ModelProvidersResponseSchema = z.looseObject({
  success: z.literal(true),
  providers: z.looseObject({
    anthropic: z.looseObject({ available: z.boolean(), hasApiKey: z.boolean() }),
    cursor: z.looseObject({
      available: z.boolean(),
      version: z.string().optional(),
      path: z.string().optional(),
      method: z.string().optional(),
      authenticated: z.boolean(),
      authenticationChecked: z.boolean(),
    }),
    'openai-compatible': z.looseObject({ available: z.boolean(), configuredEndpoints: z.number() }),
  }),
});
export const PromptEnhancementResponseSchema = z.looseObject({
  success: z.literal(true),
  enhancedText: z.string(),
});
