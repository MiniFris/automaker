import { Global, Module } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import { RuntimePathsService } from '../../core/config/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import type * as Filesystem from '../../lib/secure-fs.js';
import type { EventEmitter } from '../../lib/events.js';
import { DevServerService } from '../../services/dev-server-service.js';
import { TestRunnerService } from '../../services/test-runner-service.js';
import { SettingsService } from '../../services/settings-service.js';
import { ManagedDevServerService } from '../../services/execution-environment/dev-server.js';
import { ManagedTestRunnerService } from '../../services/execution-environment/test-runner.js';

@Global()
@Module({
  providers: [
    {
      provide: ManagedDevServerService,
      inject: [SettingsService, APPLICATION_EVENTS],
      useFactory: (settings: SettingsService, events: EventEmitter) =>
        new ManagedDevServerService(settings, events),
    },
    {
      provide: ManagedTestRunnerService,
      inject: [SettingsService, APPLICATION_EVENTS],
      useFactory: (settings: SettingsService, events: EventEmitter) =>
        new ManagedTestRunnerService(settings, events),
    },
    {
      provide: DevServerService,
      inject: [SECURE_FILESYSTEM, SecurityService, RuntimePathsService],
      useFactory: (
        filesystem: typeof Filesystem,
        security: SecurityService,
        paths: RuntimePathsService
      ) =>
        new DevServerService({
          filesystem,
          stateFilesystem: filesystem,
          dataDirectory: paths.dataDirectory,
          resolvePath: (candidate) =>
            security.validateLocalPath(
              paths.resolveFromWorkingDirectory(candidate),
              'local dev server'
            ),
        }),
    },
    {
      provide: TestRunnerService,
      inject: [APPLICATION_EVENTS, SECURE_FILESYSTEM, SecurityService, RuntimePathsService],
      useFactory: (
        events: EventEmitter,
        filesystem: typeof Filesystem,
        security: SecurityService,
        paths: RuntimePathsService
      ) => {
        const tests = new TestRunnerService({
          filesystem,
          resolvePath: (candidate) =>
            security.validateLocalPath(
              paths.resolveFromWorkingDirectory(candidate),
              'local test runner'
            ),
        });
        tests.setEventEmitter(events);
        return tests;
      },
    },
  ],
  exports: [DevServerService, TestRunnerService, ManagedDevServerService, ManagedTestRunnerService],
})
export class LocalProcessRuntimeModule {}
