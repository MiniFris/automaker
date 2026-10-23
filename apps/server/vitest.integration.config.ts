import { defineConfig } from 'vitest/config';

import { serverResolveConfig, serverTestDefaults } from './vitest.config.js';

export default defineConfig({
  test: {
    ...serverTestDefaults,
    name: 'server-integration',
    env: {
      AUTOMAKER_PREVIEW_PORT_FIRST: '43100',
      AUTOMAKER_PREVIEW_PORT_LAST: '43119',
    },
    reporters: ['default', 'hanging-process'],
    include: [
      'tests/integration/routes/**/*.test.ts',
      'tests/unit/services/preview-gateway.test.ts',
      'tests/unit/ui/summary-source-flow.integration.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
  },
  resolve: serverResolveConfig,
});
