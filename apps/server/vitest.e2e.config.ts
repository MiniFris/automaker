import { defineConfig } from 'vitest/config';

import { serverResolveConfig, serverTestDefaults } from './vitest.config.js';

export default defineConfig({
  test: {
    ...serverTestDefaults,
    name: 'server-e2e',
    reporters: ['default', 'hanging-process'],
    include: ['tests/integration/direct-provider-browser.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: serverResolveConfig,
});
