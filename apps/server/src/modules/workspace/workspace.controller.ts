import { Controller, Get, Inject } from '@nestjs/common';
import { WorkspaceService } from './workspace.service.js';
import {
  WorkspaceConfigResponseSchema,
  WorkspaceDirectoriesResponseSchema,
} from '@automaker/contracts/domains/workspace';

@Controller('workspace')
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly workspace: WorkspaceService) {}

  @Get('config')
  async getConfig(): Promise<Record<string, unknown>> {
    return WorkspaceConfigResponseSchema.parse(await this.workspace.getConfig());
  }

  @Get('directories')
  async listDirectories(): Promise<Record<string, unknown>> {
    return WorkspaceDirectoriesResponseSchema.parse(await this.workspace.listDirectories());
  }
}
