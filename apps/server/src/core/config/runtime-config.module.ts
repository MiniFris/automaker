import { DynamicModule, Global, Module } from '@nestjs/common';

import type { RuntimeConfig } from './runtime-config.js';
import { RuntimePathsService } from './runtime-paths.service.js';
import { RUNTIME_CONFIG, WORKING_DIRECTORY } from './runtime-config.tokens.js';

@Global()
@Module({})
export class RuntimeConfigModule {
  static register(config: RuntimeConfig, workingDirectory: string): DynamicModule {
    return {
      global: true,
      module: RuntimeConfigModule,
      providers: [
        { provide: RUNTIME_CONFIG, useValue: config },
        { provide: WORKING_DIRECTORY, useValue: workingDirectory },
        RuntimePathsService,
      ],
      exports: [RUNTIME_CONFIG, WORKING_DIRECTORY, RuntimePathsService],
    };
  }
}
