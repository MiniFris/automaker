import { defineConfig } from 'vitest/config';

import { serverResolveConfig, serverTestDefaults } from './vitest.config.js';

export default defineConfig({
  test: {
    ...serverTestDefaults,
    name: 'server-docker',
    env: {
      AUTOMAKER_PREVIEW_PORT_FIRST: '43300',
      AUTOMAKER_PREVIEW_PORT_LAST: '43319',
    },
    reporters: ['default', 'hanging-process'],
    include: ['tests/integration/managed-docker.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: serverResolveConfig,
});
