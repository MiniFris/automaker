import { defineConfig } from 'vitest/config';

import { serverResolveConfig, serverTestDefaults } from './vitest.config.js';

const environmentDependentTests = [
  'tests/unit/routes/environment-git.test.ts',
  'tests/unit/services/managed-dev-server.test.ts',
  'tests/unit/services/managed-feature-workspace.test.ts',
  'tests/unit/services/managed-terminal.test.ts',
  'tests/unit/services/managed-test-runner.test.ts',
  'tests/unit/services/project-git-worker.test.ts',
  'tests/unit/services/remote-cli-environment.test.ts',
  'tests/unit/services/remote-sdk-environment.test.ts',
  'tests/unit/services/ssh-environment.test.ts',
  'tests/unit/services/ssh-feature.test.ts',
  'tests/unit/services/terminal-worker.test.ts',
];

export default defineConfig({
  test: {
    ...serverTestDefaults,
    name: 'server-unit',
    reporters: ['default', 'hanging-process'],
    include: [
      'tests/unit/lib/**/*.test.ts',
      'tests/unit/providers/**/*.test.ts',
      'tests/unit/services/**/*.test.ts',
      'tests/unit/types/**/*.test.ts',
      'tests/unit/ui/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/unit/services/preview-gateway.test.ts',
      'tests/unit/ui/summary-source-flow.integration.test.ts',
      ...environmentDependentTests,
    ],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 5_000,
  },
  resolve: serverResolveConfig,
});
