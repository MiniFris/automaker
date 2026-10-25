import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { RuntimePathsService } from '../../core/config/index.js';
import {
  ForbiddenDomainError,
  NotFoundDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const MAX_BYTES = 1024 * 1024;
/** Bounded, fail-closed IO for explicitly resolved host setup JSON files. */
@Injectable()
export class HostSetupJsonFiles {
  constructor(@Inject(RuntimePathsService) private readonly paths: RuntimePathsService) {}
  async canonical(candidate: string): Promise<string> {
    try {
      return await fs.realpath(candidate);
    } catch (error) {
      if (!missing(error)) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      return path.join(await this.canonical(parent), path.basename(candidate));
    }
  }

  async projectLocation(
    projectPath: string | undefined,
    directory: '.cursor' | '.automaker',
    fileName: string,
    allowMissingProject = false
  ) {
    if (
      !['.cursor', '.automaker'].includes(directory) ||
      path.basename(fileName) !== fileName ||
      fileName === '.' ||
      fileName === '..'
    )
      throw new ValidationDomainError('Invalid setup config filename.');
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
    const configPath = path.join(root, directory, fileName);
    // Do not silently follow a project config-directory symlink into another profile.
    if ((await this.canonicalParent(configPath)) !== configPath)
      throw new ForbiddenDomainError('Setup config directory must not be a symlink.');
    return { projectPath: root, configPath };
  }

  async canonicalParent(file: string): Promise<string> {
    return path.join(await this.canonical(path.dirname(file)), path.basename(file));
  }

  private async assertFile(file: string): Promise<void> {
    if ((await this.canonicalParent(file)) !== file)
      throw new ForbiddenDomainError('Setup config directory changed.');
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
        throw new ForbiddenDomainError('Setup config must be a regular unshared file.');
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
      return record;
    } catch (error) {
      if (missing(error)) return null;
      throw new UnavailableDomainError('Host setup config is unavailable or invalid.');
    } finally {
      await handle?.close();
    }
  }

  async replace(file: string, config: Record<string, unknown>): Promise<void> {
    const content = JSON.stringify(config, null, 2);
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new ValidationDomainError('Setup config is too large.');
    await this.assertFile(file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.assertFile(file);
    const temporary = path.join(path.dirname(file), `.automaker-setup-${randomUUID()}.tmp`);
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

  async remove(file: string): Promise<void> {
    await this.assertFile(file);
    await fs.unlink(file).catch((error) => {
      if (!missing(error)) throw error;
    });
  }
}
