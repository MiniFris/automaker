import { Controller, Get, Inject } from '@nestjs/common';
import { ProjectOverviewService } from './project-overview.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectOverviewService) private readonly projects: ProjectOverviewService) {}

  @Get('overview')
  overview(): Promise<Record<string, unknown>> {
    return this.projects.overview();
  }
}
