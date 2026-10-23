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
export const ModelTimeoutUpdateSchema = z.object({ timeouts: z.unknown() }).strict();
export type ModelTimeoutUpdate = z.infer<typeof ModelTimeoutUpdateSchema>;

export const GlobalSettingsUpdateSchema = z.record(z.string(), z.unknown());

export const CredentialsUpdateSchema = z.record(z.string(), z.unknown());
export type CredentialsUpdate = z.infer<typeof CredentialsUpdateSchema>;

export const ProjectSettingsUpdateSchema = z
  .object({
    projectPath: ProjectPathSchema,
    updates: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ProjectSettingsUpdate = z.infer<typeof ProjectSettingsUpdateSchema>;

const LocalStorageDataSchema = z
  .object({
    'automaker-storage': z.string().optional(),
    'automaker-setup': z.string().optional(),
    'worktree-panel-collapsed': z.string().optional(),
    'file-browser-recent-folders': z.string().optional(),
    'automaker:lastProjectDir': z.string().optional(),
  })
  .strict();

export const LocalStorageMigrationRequestSchema = z
  .object({ data: LocalStorageDataSchema })
  .strict();
export type LocalStorageMigrationRequest = z.infer<typeof LocalStorageMigrationRequestSchema>;

export const DirectSettingsMutationSchema = z.record(z.string(), z.unknown());
