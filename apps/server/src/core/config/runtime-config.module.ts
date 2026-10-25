import { DynamicModule, Global, Module } from '@nestjs/common';

import type { RuntimeConfig } from './runtime-config.js';
import { RuntimePathsService } from './runtime-paths.service.js';
import { HOST_ENVIRONMENT, RUNTIME_CONFIG, WORKING_DIRECTORY } from './runtime-config.tokens.js';
import { HOST_PROFILE_CONFIG, type HostProfileConfig } from './host-profile.config.js';
import { PreviewPolicy } from './preview-policy.js';

@Global()
@Module({})
export class RuntimeConfigModule {
  static register(
    config: RuntimeConfig,
    workingDirectory: string,
    environment: NodeJS.ProcessEnv = process.env
  ): DynamicModule {
    return {
      global: true,
      module: RuntimeConfigModule,
      providers: [
        { provide: RUNTIME_CONFIG, useValue: config },
        { provide: WORKING_DIRECTORY, useValue: workingDirectory },
        { provide: HOST_ENVIRONMENT, useValue: Object.freeze({ ...environment }) },
        {
          provide: HOST_PROFILE_CONFIG,
          useValue: Object.freeze({
            platform: process.platform,
            homeDirectory: environment.HOME || environment.USERPROFILE,
          } satisfies HostProfileConfig),
        },
        RuntimePathsService,
        { provide: PreviewPolicy, useFactory: () => new PreviewPolicy(config.preview) },
      ],
      exports: [
        RUNTIME_CONFIG,
        WORKING_DIRECTORY,
        HOST_ENVIRONMENT,
        HOST_PROFILE_CONFIG,
        RuntimePathsService,
        PreviewPolicy,
      ],
    };
  }
}
