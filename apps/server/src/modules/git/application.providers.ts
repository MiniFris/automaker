import type { FactoryProvider } from '@nestjs/common';
import { GitApplicationService } from './git-application.service.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { FEATURE_RUN_READ_MODEL } from '../auto-mode/auto-mode.ports.js';

export const gitApplicationServiceProvider: FactoryProvider<GitApplicationService> = {
  provide: GitApplicationService,
  inject: [ProjectGitService, FEATURE_RUN_READ_MODEL],
  useFactory: (
    git: ConstructorParameters<typeof GitApplicationService>[0],
    autoMode: ConstructorParameters<typeof GitApplicationService>[1]
  ) => new GitApplicationService(git, autoMode),
};
