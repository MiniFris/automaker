import { Global, Module } from '@nestjs/common';
import { SettingsService } from '../../services/settings-service.js';
import {
  DockerExecutionAdapter,
  LocalExecutionAdapter,
  SshExecutionAdapter,
} from './execution.adapters.js';
import { EXECUTION_ADAPTERS } from './execution.port.js';
import { ExecutionRegistry } from './execution-registry.service.js';

@Global()
@Module({
  providers: [
    { provide: 'EXECUTION_SETTINGS', useExisting: SettingsService },
    LocalExecutionAdapter,
    DockerExecutionAdapter,
    SshExecutionAdapter,
    {
      provide: EXECUTION_ADAPTERS,
      inject: [LocalExecutionAdapter, DockerExecutionAdapter, SshExecutionAdapter],
      useFactory: (...adapters) => Object.freeze(adapters),
    },
    ExecutionRegistry,
  ],
  exports: [ExecutionRegistry],
})
export class ExecutionModule {}
