import { defineConfig } from 'vitest/config';

import { serverResolveConfig, serverTestDefaults } from './vitest.config.js';

export default defineConfig({
  test: {
    ...serverTestDefaults,
    name: 'server-contract',
    reporters: ['default', 'hanging-process'],
    include: ['tests/contract/**/*.test.ts', 'tests/unit/routes/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/unit/routes/environment-git.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 5_000,
    fileParallelism: false,
  },
  resolve: serverResolveConfig,
});
