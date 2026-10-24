import { Global, Module } from '@nestjs/common';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import type { EventEmitter } from '../../lib/events.js';
import { DevServerService } from '../../services/dev-server-service.js';
import { TestRunnerService } from '../../services/test-runner-service.js';

@Global()
@Module({
  providers: [
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
  exports: [DevServerService, TestRunnerService],
})
export class LocalProcessRuntimeModule {}
