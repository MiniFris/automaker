// Compatibility for existing SSH consumers. New services use the common feature adapter.
export {
  FeatureWorkspaceService as SSHFeatureService,
  featureRunKey,
} from './feature-workspace.js';
export type { FeatureWorkspaceRun as SSHFeatureRun } from './feature-workspace.js';
