import { Controller, Get, Inject } from '@nestjs/common';
import { ProjectOverviewService } from './project-overview.service.js';
import { ProjectsOverviewResponseSchema } from '@automaker/contracts';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectOverviewService) private readonly projects: ProjectOverviewService) {}

  @Get('overview')
  async overview() {
    return ProjectsOverviewResponseSchema.parse(await this.projects.overview());
  }
}
