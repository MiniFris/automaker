import { Module } from '@nestjs/common';
import { SettingsService } from '../../services/settings-service.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { GitApplicationService } from './git-application.service.js';
import { GitController } from './git.controller.js';

@Module({
  controllers: [GitController],
  providers: [
    {
      provide: ProjectGitService,
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => new ProjectGitService(settings),
    },
    GitApplicationService,
  ],
  exports: [ProjectGitService],
})
export class GitModule {}
