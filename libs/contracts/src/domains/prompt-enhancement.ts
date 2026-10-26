import { z } from 'zod';
import { OutputLocaleSchema } from '../generation-language.js';

export const PromptEnhancementRequestSchema = z.object({
  outputLocale: OutputLocaleSchema.optional(),
  originalText: z.string().min(1, 'originalText is required and must be a string'),
  enhancementMode: z.string().min(1, 'enhancementMode is required and must be a string'),
  model: z.string().optional(),
  providerId: z.string().optional(),
  thinkingLevel: z.enum(['none', 'low', 'medium', 'high', 'ultrathink', 'adaptive']).optional(),
  projectPath: z.string().min(1).optional(),
});

export type PromptEnhancementRequest = z.infer<typeof PromptEnhancementRequestSchema>;
