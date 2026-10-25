import { defineConfig } from 'vitest/config';

import { serverResolveConfig, serverTestDefaults } from './vitest.config.js';

export default defineConfig({
  test: {
    ...serverTestDefaults,
    name: 'server-ssh',
    env: {
      AUTOMAKER_PREVIEW_PORT_FIRST: '43200',
      AUTOMAKER_PREVIEW_PORT_LAST: '43219',
    },
    reporters: ['default', 'hanging-process'],
    include: [
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
    ],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    fileParallelism: false,
  },
  resolve: serverResolveConfig,
});
