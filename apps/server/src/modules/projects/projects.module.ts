import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProjectOverviewService } from './project-overview.service.js';
import { ProjectRegistry } from './project-registry.service.js';
import { ProjectsController } from './projects.controller.js';

@Module({
  imports: [NotificationsModule],
  controllers: [ProjectsController],
  providers: [ProjectRegistry, ProjectOverviewService],
  exports: [ProjectRegistry],
})
export class ProjectsModule {}
