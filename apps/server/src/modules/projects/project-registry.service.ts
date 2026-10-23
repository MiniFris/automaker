import { Inject, Injectable } from '@nestjs/common';
import type { ProjectRef } from '@automaker/types';
import { SecurityService } from '../../core/security/security.service.js';
import { SettingsService } from '../../services/settings-service.js';

export interface RegisteredProject {
  id: string;
  name: string;
  path: string;
}

@Injectable()
export class ProjectRegistry {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SecurityService) private readonly security: SecurityService
  ) {}

  async list(): Promise<RegisteredProject[]> {
    const refs: ProjectRef[] = (await this.settings.getGlobalSettings()).projects ?? [];
    return refs.map((project) => ({
      id: project.id,
      name: project.name,
      path: this.security.validateLocalPath(project.path, `project registry read (${project.id})`),
    }));
  }
}
