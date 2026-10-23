export const DATA_DIRECTORY = Symbol('DATA_DIRECTORY');
export const LEGACY_APPLICATION = Symbol('LEGACY_APPLICATION');
export const LEGACY_EVENT_EMITTER = Symbol('LEGACY_EVENT_EMITTER');

export const LEGACY_SERVICES = {
  settings: Symbol('LEGACY_SETTINGS_SERVICE'),
  agent: Symbol('LEGACY_AGENT_SERVICE'),
  featureLoader: Symbol('LEGACY_FEATURE_LOADER'),
  autoMode: Symbol('LEGACY_AUTO_MODE_SERVICE'),
  claudeUsage: Symbol('LEGACY_CLAUDE_USAGE_SERVICE'),
  codexAppServer: Symbol('LEGACY_CODEX_APP_SERVER_SERVICE'),
  codexModelCache: Symbol('LEGACY_CODEX_MODEL_CACHE_SERVICE'),
  codexUsage: Symbol('LEGACY_CODEX_USAGE_SERVICE'),
  zaiUsage: Symbol('LEGACY_ZAI_USAGE_SERVICE'),
  geminiUsage: Symbol('LEGACY_GEMINI_USAGE_SERVICE'),
  mcpTest: Symbol('LEGACY_MCP_TEST_SERVICE'),
  ideation: Symbol('LEGACY_IDEATION_SERVICE'),
  devServer: Symbol('LEGACY_DEV_SERVER_SERVICE'),
  notification: Symbol('LEGACY_NOTIFICATION_SERVICE'),
  eventHistory: Symbol('LEGACY_EVENT_HISTORY_SERVICE'),
  testRunner: Symbol('LEGACY_TEST_RUNNER_SERVICE'),
  terminal: Symbol('LEGACY_TERMINAL_SERVICE'),
  pipeline: Symbol('LEGACY_PIPELINE_SERVICE'),
  eventHook: Symbol('LEGACY_EVENT_HOOK_SERVICE'),
} as const;
