import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CursorPermissionsSchema, type CursorPermissionsTarget } from '@automaker/contracts';
import type { CursorCliPermissions } from '@automaker/types';
import { HOST_ENVIRONMENT, RuntimePathsService } from '../../core/config/index.js';
import {
  ForbiddenDomainError,
  NotFoundDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const MAX_BYTES = 1024 * 1024;

/** Host-only Cursor CLI config. Paths derive from the immutable bootstrap snapshot. */
@Injectable()
export class CursorPermissionsRepository {
  private readonly globalPath: string;
  constructor(
    @Inject(RuntimePathsService) private readonly paths: RuntimePathsService,
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>
  ) {
    const directory =
      environment.CURSOR_CONFIG_DIR ||
      (process.platform === 'linux' && environment.XDG_CONFIG_HOME
        ? path.join(environment.XDG_CONFIG_HOME, 'cursor')
        : path.join(os.homedir(), '.cursor'));
    this.globalPath = paths.resolveFromWorkingDirectory(directory, 'cli-config.json');
  }

  private async canonical(candidate: string): Promise<string> {
    try {
      return await fs.realpath(candidate);
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      return path.join(await this.canonical(parent), path.basename(candidate));
    }
  }

  async location(scope: 'global' | 'project', projectPath?: string, allowMissingProject = false) {
    if (scope === 'global')
      return { scope, configPath: await this.canonicalParent(this.globalPath) } as const;
    if (
      typeof projectPath !== 'string' ||
      !projectPath ||
      !path.isAbsolute(projectPath) ||
      projectPath.includes(String.fromCharCode(0))
    )
      throw new ValidationDomainError('An absolute project path is required.');
    let root: string;
    try {
      root = await fs.realpath(projectPath);
      if (!(await fs.stat(root)).isDirectory())
        throw new ValidationDomainError('Project must be a directory.');
    } catch (error) {
      if (!missing(error)) throw error;
      if (!allowMissingProject) throw new NotFoundDomainError('Project directory does not exist.');
      root = await this.canonical(projectPath);
    }
    if (this.paths.allowedRootDirectory) {
      const allowed = await this.canonical(
        this.paths.resolveFromWorkingDirectory(this.paths.allowedRootDirectory)
      );
      const relative = path.relative(allowed, root);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new ForbiddenDomainError('Project is outside the configured allowed root.');
    }
    const configPath = path.join(root, '.cursor', 'cli.json');
    // Do not silently follow a project .cursor symlink into another profile.
    if ((await this.canonicalParent(configPath)) !== configPath)
      throw new ForbiddenDomainError('Cursor config directory must not be a symlink.');
    return { scope, projectPath: root, configPath } as const;
  }

  private async canonicalParent(file: string): Promise<string> {
    return path.join(await this.canonical(path.dirname(file)), path.basename(file));
  }

  private async assertFile(file: string): Promise<void> {
    if ((await this.canonicalParent(file)) !== file)
      throw new ForbiddenDomainError('Cursor config directory changed.');
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
        throw new ForbiddenDomainError('Cursor config must be a regular unshared file.');
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  async read(file: string): Promise<Record<string, unknown> | null> {
    await this.assertFile(file);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_BYTES)
        throw new Error('Invalid config size or type');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_BYTES) throw new Error('Config too large');
      const value: unknown = JSON.parse(buffer.subarray(0, size).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid config object');
      const record = value as Record<string, unknown>;
      if (record.permissions !== undefined) CursorPermissionsSchema.parse(record.permissions);
      return record;
    } catch (error) {
      if (missing(error)) return null;
      throw new UnavailableDomainError('Cursor permissions config is unavailable or invalid.');
    } finally {
      await handle?.close();
    }
  }

  async write(target: CursorPermissionsTarget, permissions: CursorCliPermissions): Promise<void> {
    const file = target.configPath;
    const existing = await this.read(file);
    const config = {
      ...(target.scope === 'global' ? { version: 1 } : {}),
      ...existing,
      permissions,
    };
    const content = JSON.stringify(config, null, 2);
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new ValidationDomainError('Cursor config is too large.');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.replace(file, content);
  }

  private async replace(file: string, content: string): Promise<void> {
    await this.assertFile(file);
    const temporary = path.join(path.dirname(file), `.automaker-permissions-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let owned = false;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      owned = true;
      await handle.writeFile(content);
      await handle.close();
      handle = undefined;
      await this.assertFile(file);
      await fs.rename(temporary, file);
    } finally {
      await handle?.close();
      if (owned)
        await fs.unlink(temporary).catch((error) => {
          if (!missing(error)) throw error;
        });
    }
  }

  async delete(target: CursorPermissionsTarget): Promise<void> {
    if (target.scope !== 'project')
      throw new ValidationDomainError('Only project permissions can be deleted.');
    // Remove only the permissions property; preserve unrelated project settings.
    const existing = await this.read(target.configPath);
    if (!existing) return;
    const { permissions: _permissions, ...rest } = existing;
    if (Object.keys(rest).length) {
      await this.replace(target.configPath, JSON.stringify(rest, null, 2));
    } else {
      await this.assertFile(target.configPath);
      await fs.unlink(target.configPath).catch((error) => {
        if (!missing(error)) throw error;
      });
    }
  }
}
