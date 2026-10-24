export const LEGACY_APPLICATION = Symbol('LEGACY_APPLICATION');

export const LEGACY_SERVICES = {
  autoMode: Symbol('LEGACY_AUTO_MODE_SERVICE'),
  mcpTest: Symbol('LEGACY_MCP_TEST_SERVICE'),
  ideation: Symbol('LEGACY_IDEATION_SERVICE'),
  devServer: Symbol('LEGACY_DEV_SERVER_SERVICE'),
  testRunner: Symbol('LEGACY_TEST_RUNNER_SERVICE'),
  terminal: Symbol('LEGACY_TERMINAL_SERVICE'),
  pipeline: Symbol('LEGACY_PIPELINE_SERVICE'),
  eventHook: Symbol('LEGACY_EVENT_HOOK_SERVICE'),
} as const;
