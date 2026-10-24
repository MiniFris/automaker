import type { DevServerService } from '../../services/dev-server-service.js';
import type { TestRunnerService } from '../../services/test-runner-service.js';
import type { InitScriptService } from '../../services/init-script-service.js';
import type { SettingsService } from '../../services/settings-service.js';
import type { EventEmitter } from '../../lib/events.js';
import type { ManagedDevServerService } from '../../services/execution-environment/dev-server.js';
import type { ManagedTestRunnerService } from '../../services/execution-environment/test-runner.js';

/** Explicit owners for the unmounted compatibility router used by transport fixtures. */
export interface WorktreeRouteServices {
  dev: DevServerService;
  tests: TestRunnerService;
  init: InitScriptService;
  createManagedDev(settings: SettingsService, events: EventEmitter): ManagedDevServerService;
  createManagedTests(settings: SettingsService, events: EventEmitter): ManagedTestRunnerService;
}
