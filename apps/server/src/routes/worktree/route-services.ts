import type { DevServerService } from '../../services/dev-server-service.js';
import type { TestRunnerService } from '../../services/test-runner-service.js';
import type { InitScriptService } from '../../services/init-script-service.js';

/** Explicit owners for the unmounted compatibility router used by transport fixtures. */
export interface WorktreeRouteServices {
  dev: DevServerService;
  tests: TestRunnerService;
  init: InitScriptService;
}
