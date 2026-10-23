import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import type * as SecureFilesystem from '../../lib/secure-fs.js';
import {
  DomainError,
  ForbiddenDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import { TEMPLATE_COMMAND_RUNNER, type TemplateCommandRunner } from './template-command.runner.js';
import type { CloneTemplateRequest } from './templates.schemas.js';

const logger = createLogger('Templates');

@Injectable()
export class TemplatesService {
  constructor(
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof SecureFilesystem,
    @Inject(SecurityService) private readonly security: SecurityService,
    @Inject(TEMPLATE_COMMAND_RUNNER) private readonly commands: TemplateCommandRunner
  ) {}

  async clone(input: CloneTemplateRequest): Promise<Record<string, unknown>> {
    const sanitizedName = input.projectName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const parentDir = this.validatePath(input.parentDir, 'clone template parent');
    const projectPath = this.validatePath(
      path.join(parentDir, sanitizedName),
      'clone template destination'
    );
    const relativePath = path.relative(parentDir, projectPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath))
      throw new ValidationDomainError('Invalid project name; potential path traversal attempt.');

    if (await this.exists(projectPath))
      throw new ValidationDomainError(
        `Directory "${sanitizedName}" already exists in ${input.parentDir}`
      );

    await this.filesystem.mkdir(parentDir, { recursive: true });
    let cloneStarted = false;
    try {
      cloneStarted = true;
      const clone = await this.commands.run(
        'git',
        ['clone', input.repoUrl, projectPath],
        parentDir
      );
      if (clone.exitCode !== 0)
        throw new DomainError('Failed to clone repository', 'UNKNOWN_OUTCOME', 500);

      await this.filesystem.rm(path.join(projectPath, '.git'), { recursive: true, force: true });
      const initialize = await this.commands.run('git', ['init'], projectPath);
      if (initialize.exitCode !== 0) logger.warn('Could not initialize cloned template repository');

      return { success: true, projectPath, projectName: sanitizedName };
    } catch (error) {
      if (cloneStarted)
        await this.filesystem
          .rm(projectPath, { recursive: true, force: true })
          .catch((cleanupError) =>
            logger.error('Failed to clean partial template clone', cleanupError)
          );
      throw error;
    }
  }

  private validatePath(candidate: string, operation: string): string {
    try {
      return this.security.validateLocalPath(candidate, operation);
    } catch {
      throw new ForbiddenDomainError(
        `Project path not allowed: ${candidate}. Must be within ALLOWED_ROOT_DIRECTORY.`
      );
    }
  }

  private async exists(candidate: string): Promise<boolean> {
    try {
      await this.filesystem.access(candidate);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
