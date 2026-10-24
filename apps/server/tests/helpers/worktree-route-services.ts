import { afterEach } from 'vitest';
import { DevServerService } from '../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../src/services/test-runner-service.js';
import { InitScriptService } from '../../src/services/init-script-service.js';
import type { WorktreeRouteServices } from '../../src/routes/worktree/route-services.js';
import { ManagedDevServerService } from '../../src/services/execution-environment/dev-server.js';
import { ManagedTestRunnerService } from '../../src/services/execution-environment/test-runner.js';

const owned = new Set<() => Promise<void>>();
afterEach(async () => {
  await Promise.all([...owned].map((close) => close()));
  owned.clear();
});

export function createTestWorktreeRouteServices(
  overrides: {
    managedDev?: ManagedDevServerService;
    managedTests?: ManagedTestRunnerService;
  } = {}
): WorktreeRouteServices {
  const managed = new Set<ManagedDevServerService | ManagedTestRunnerService>();
  const context: WorktreeRouteServices = {
    dev: new DevServerService(),
    tests: new TestRunnerService(),
    init: new InitScriptService(),
    createManagedDev(settings, events) {
      const service = overrides.managedDev ?? new ManagedDevServerService(settings, events);
      managed.add(service);
      return service;
    },
    createManagedTests(settings, events) {
      const service = overrides.managedTests ?? new ManagedTestRunnerService(settings, events);
      managed.add(service);
      return service;
    },
  };
  owned.add(async () => {
    await Promise.all([
      context.dev.stopAll(),
      context.tests.cleanup(),
      ...[...managed].map((service) => service.cleanup()),
    ]);
  });
  return context;
}
