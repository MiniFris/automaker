import { Controller, Get, Inject } from '@nestjs/common';
import { WorkspaceService } from './workspace.service.js';

@Controller('workspace')
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly workspace: WorkspaceService) {}

  @Get('config')
  getConfig(): Promise<Record<string, unknown>> {
    return this.workspace.getConfig();
  }

  @Get('directories')
  listDirectories(): Promise<Record<string, unknown>> {
    return this.workspace.listDirectories();
  }
}
