import { z } from 'zod';
import { MODEL_TIMEOUT_PROVIDERS } from '@automaker/types';
import { ProjectPathSchema } from '@automaker/contracts';

export const ProjectSettingsReadSchema = z.object({ projectPath: ProjectPathSchema }).strict();
export type ProjectSettingsRead = z.infer<typeof ProjectSettingsReadSchema>;

export const DiscoverAgentsSchema = z
  .object({
    projectPath: ProjectPathSchema.optional(),
    sources: z
      .array(z.enum(['user', 'project']))
      .max(2)
      .optional(),
  })
  .strict();
export type DiscoverAgentsRequest = z.infer<typeof DiscoverAgentsSchema>;

export const ModelTimeoutProviderSchema = z.enum(MODEL_TIMEOUT_PROVIDERS);
