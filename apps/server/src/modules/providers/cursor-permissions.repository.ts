import path from 'node:path';
import os from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import { CursorPermissionsSchema, type CursorPermissionsTarget } from '@automaker/contracts';
import type { CursorCliPermissions } from '@automaker/types';
import { HOST_ENVIRONMENT, RuntimePathsService } from '../../core/config/index.js';
import { UnavailableDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { HostSetupJsonFiles } from './host-setup-json-files.js';

/** Host-only Cursor permissions; profile location uses the bootstrap snapshot. */
@Injectable()
export class CursorPermissionsRepository {
  private readonly globalPath: string;
  constructor(
    @Inject(RuntimePathsService) paths: RuntimePathsService,
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>,
    @Inject(HostSetupJsonFiles) private readonly files: HostSetupJsonFiles
  ) {
    const directory =
      environment.CURSOR_CONFIG_DIR ||
      (process.platform === 'linux' && environment.XDG_CONFIG_HOME
        ? path.join(environment.XDG_CONFIG_HOME, 'cursor')
        : path.join(os.homedir(), '.cursor'));
    this.globalPath = paths.resolveFromWorkingDirectory(directory, 'cli-config.json');
  }
  async location(scope: 'global' | 'project', projectPath?: string, allowMissingProject = false) {
    if (scope === 'global')
      return { scope, configPath: await this.files.canonicalParent(this.globalPath) } as const;
    return {
      scope,
      ...(await this.files.projectLocation(
        projectPath,
        '.cursor',
        'cli.json',
        allowMissingProject
      )),
    } as const;
  }
  async read(file: string): Promise<Record<string, unknown> | null> {
    const record = await this.files.read(file);
    if (
      record?.permissions !== undefined &&
      !CursorPermissionsSchema.safeParse(record.permissions).success
    )
      throw new UnavailableDomainError('Cursor permissions config is unavailable or invalid.');
    return record;
  }
  async write(target: CursorPermissionsTarget, permissions: CursorCliPermissions): Promise<void> {
    const existing = await this.read(target.configPath);
    await this.files.replace(target.configPath, {
      ...(target.scope === 'global' ? { version: 1 } : {}),
      ...existing,
      permissions,
    });
  }
  async delete(target: CursorPermissionsTarget): Promise<void> {
    if (target.scope !== 'project')
      throw new ValidationDomainError('Only project permissions can be deleted.');
    const existing = await this.read(target.configPath);
    if (!existing) return;
    const { permissions: _permissions, ...rest } = existing;
    if (Object.keys(rest).length) await this.files.replace(target.configPath, rest);
    else await this.files.remove(target.configPath);
  }
}
