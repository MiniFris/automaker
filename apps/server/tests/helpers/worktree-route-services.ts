import { afterEach } from 'vitest';
import { DevServerService } from '../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../src/services/test-runner-service.js';
import { InitScriptService } from '../../src/services/init-script-service.js';
import type { WorktreeRouteServices } from '../../src/routes/worktree/route-services.js';

const owned = new Set<WorktreeRouteServices>();
afterEach(async () => {
  await Promise.all(
    [...owned].map(async (context) => {
      await Promise.all([context.dev.stopAll(), context.tests.cleanup()]);
    })
  );
  owned.clear();
});

export function createTestWorktreeRouteServices(): WorktreeRouteServices {
  const context = {
    dev: new DevServerService(),
    tests: new TestRunnerService(),
    init: new InitScriptService(),
  };
  owned.add(context);
  return context;
}
