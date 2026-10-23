import { Module } from '@nestjs/common';
import { GitModule } from '../git/git.module.js';
import { WorktreeApplicationService } from './worktree-application.service.js';
import { WorktreeController } from './worktree.controller.js';
import { WorktreeProcessService } from './worktree-process.service.js';
import { WorktreeHostService } from './worktree-host.service.js';
import { WorktreeTextService } from './worktree-text.service.js';
import { ContextModule } from '../context/context.module.js';

@Module({
  imports: [GitModule, ContextModule],
  controllers: [WorktreeController],
  providers: [
    WorktreeApplicationService,
    WorktreeProcessService,
    WorktreeHostService,
    WorktreeTextService,
  ],
})
export class WorktreeModule {}
