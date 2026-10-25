import { defineConfig } from 'vitest/config';
import serverConfig from './vitest.config.js';

// Reuse each tier's isolation and deadlines instead of the catch-all project's
// default five-second timeout. Transport fixtures run in their own CI job.
export default defineConfig({
  test: {
    projects: [
      './vitest.unit.config.ts',
      './vitest.contract.config.ts',
      './vitest.integration.config.ts',
    ],
    maxWorkers: 2,
    coverage: serverConfig.test?.coverage,
  },
});
