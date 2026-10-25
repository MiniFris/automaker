import type { FactoryProvider } from '@nestjs/common';
import { WorktreeApplicationService } from './worktree-application.service.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { APPLICATION_EVENTS } from '../../core/eventing/application-events.js';
import { FEATURE_RUN_READ_MODEL } from '../auto-mode/auto-mode.ports.js';
import { SettingsService } from '../../services/settings-service.js';
import { FeatureLoader } from '../../services/feature-loader.js';

export const worktreeApplicationServiceProvider: FactoryProvider<WorktreeApplicationService> = {
  provide: WorktreeApplicationService,
  inject: [
    ProjectGitService,
    APPLICATION_EVENTS,
    FEATURE_RUN_READ_MODEL,
    SettingsService,
    FeatureLoader,
  ],
  useFactory: (
    git: ConstructorParameters<typeof WorktreeApplicationService>[0],
    events: ConstructorParameters<typeof WorktreeApplicationService>[1],
    autoMode: ConstructorParameters<typeof WorktreeApplicationService>[2],
    settings: ConstructorParameters<typeof WorktreeApplicationService>[3],
    features: ConstructorParameters<typeof WorktreeApplicationService>[4]
  ) => new WorktreeApplicationService(git, events, autoMode, settings, features),
};
