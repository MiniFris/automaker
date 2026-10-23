import { Module } from '@nestjs/common';
import { GitModule } from '../git/git.module.js';
import { WorktreeApplicationService } from './worktree-application.service.js';
import { WorktreeController } from './worktree.controller.js';

@Module({
  imports: [GitModule],
  controllers: [WorktreeController],
  providers: [WorktreeApplicationService],
})
export class WorktreeModule {}
