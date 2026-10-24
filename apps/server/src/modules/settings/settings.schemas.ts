import { z } from 'zod';
import { MODEL_TIMEOUT_PROVIDERS } from '@automaker/types';

export {
  ProjectSettingsReadSchema,
  DiscoverAgentsSchema,
  ModelTimeoutUpdateSchema,
  GlobalSettingsUpdateSchema,
  ProjectSettingsUpdateSchema,
  LocalStorageMigrationRequestSchema,
  DirectSettingsMutationSchema,
} from '@automaker/contracts';
export type {
  ProjectSettingsRead,
  DiscoverAgentsRequest,
  ModelTimeoutUpdate,
  ProjectSettingsUpdate,
  LocalStorageMigrationRequest,
} from '@automaker/contracts';

// The provider list is owned by @automaker/types; the request envelope itself
// remains shared in @automaker/contracts.
export const ModelTimeoutProviderSchema = z.enum(MODEL_TIMEOUT_PROVIDERS);
