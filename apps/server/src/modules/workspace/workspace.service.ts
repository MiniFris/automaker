import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type * as SecureFilesystem from '../../lib/secure-fs.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { ValidationDomainError } from '../../core/errors/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof SecureFilesystem,
    @Inject(SecurityService) private readonly security: SecurityService
  ) {}

  async getConfig(): Promise<Record<string, unknown>> {
    const allowedRootDirectory = this.config.storage.allowedRootDirectory;
    if (!allowedRootDirectory) {
      return {
        success: true,
        configured: false,
        defaultDir: this.config.storage.dataDirectory || null,
      };
    }
    const workspaceDir = this.security.validateLocalPath(allowedRootDirectory, 'workspace config');
    try {
      const stats = await this.filesystem.stat(workspaceDir);
      if (!stats.isDirectory())
        return {
          success: true,
          configured: false,
          error: 'ALLOWED_ROOT_DIRECTORY is not a valid directory',
        };
      return {
        success: true,
        configured: true,
        workspaceDir,
        defaultDir: workspaceDir,
      };
    } catch {
      return {
        success: true,
        configured: false,
        error: 'ALLOWED_ROOT_DIRECTORY path does not exist',
      };
    }
  }

  async listDirectories(): Promise<Record<string, unknown>> {
    const allowedRootDirectory = this.config.storage.allowedRootDirectory;
    if (!allowedRootDirectory)
      throw new ValidationDomainError('ALLOWED_ROOT_DIRECTORY is not configured');
    const workspaceDir = this.security.validateLocalPath(
      allowedRootDirectory,
      'list workspace directories'
    );
    try {
      await this.filesystem.stat(workspaceDir);
    } catch {
      throw new ValidationDomainError('Workspace directory path does not exist');
    }
    const entries = await this.filesystem.readdir(workspaceDir, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(workspaceDir, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { success: true, directories };
  }
}
