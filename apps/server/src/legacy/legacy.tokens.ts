export const DATA_DIRECTORY = Symbol('DATA_DIRECTORY');
export const LEGACY_APPLICATION = Symbol('LEGACY_APPLICATION');
export const LEGACY_EVENT_EMITTER = Symbol('LEGACY_EVENT_EMITTER');

export const LEGACY_SERVICES = {
  settings: Symbol('LEGACY_SETTINGS_SERVICE'),
  agent: Symbol('LEGACY_AGENT_SERVICE'),
  featureLoader: Symbol('LEGACY_FEATURE_LOADER'),
  autoMode: Symbol('LEGACY_AUTO_MODE_SERVICE'),
  mcpTest: Symbol('LEGACY_MCP_TEST_SERVICE'),
  ideation: Symbol('LEGACY_IDEATION_SERVICE'),
  devServer: Symbol('LEGACY_DEV_SERVER_SERVICE'),
  notification: Symbol('LEGACY_NOTIFICATION_SERVICE'),
  eventHistory: Symbol('LEGACY_EVENT_HISTORY_SERVICE'),
  testRunner: Symbol('LEGACY_TEST_RUNNER_SERVICE'),
  terminal: Symbol('LEGACY_TERMINAL_SERVICE'),
  pipeline: Symbol('LEGACY_PIPELINE_SERVICE'),
  eventHook: Symbol('LEGACY_EVENT_HOOK_SERVICE'),
  loginAttemptStore: Symbol('LEGACY_LOGIN_ATTEMPT_STORE'),
  providerConnections: Symbol('LEGACY_PROVIDER_CONNECTION_REPOSITORY'),
  providerRegistry: Symbol('LEGACY_PROVIDER_REGISTRY'),
} as const;
