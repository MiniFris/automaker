import { gitApplicationServiceProvider } from './application.providers.js';
import { Module } from '@nestjs/common';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';

import { GitController } from './git.controller.js';

@Module({
  controllers: [GitController],
  providers: [
    {
      provide: ProjectGitService,
      inject: [SettingsService, HOST_ENVIRONMENT],
      useFactory: (settings: SettingsService, environment: Readonly<NodeJS.ProcessEnv>) =>
        new ProjectGitService(
          settings,
          undefined,
          undefined,
          captureNativeLocalEnvironment(environment)
        ),
    },
    gitApplicationServiceProvider,
  ],
  exports: [ProjectGitService],
})
export class GitModule {}
