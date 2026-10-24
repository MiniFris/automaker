import { Global, Module } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
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
    { provide: DevServerService, useFactory: () => new DevServerService() },
    {
      provide: TestRunnerService,
      inject: [APPLICATION_EVENTS],
      useFactory: (events: EventEmitter) => {
        const tests = new TestRunnerService();
        tests.setEventEmitter(events);
        return tests;
      },
    },
  ],
  exports: [DevServerService, TestRunnerService, ManagedDevServerService, ManagedTestRunnerService],
})
export class LocalProcessRuntimeModule {}
