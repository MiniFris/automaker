import { Inject, Injectable } from '@nestjs/common';
import type * as Filesystem from '../../lib/secure-fs.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ConflictDomainError,
  DomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
import type { ProjectFilePort } from './project-file.port.js';

@Injectable()
export class LocalProjectFileAdapter implements ProjectFilePort {
  constructor(
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof Filesystem,
    @Inject(SecurityService) private readonly security: SecurityService
  ) {}
  async read(filePath: string): Promise<string> {
    return (await this.filesystem.readFile(filePath, 'utf-8')) as string;
  }

  async list(directoryPath: string) {
    return (await this.filesystem.readdir(directoryPath, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  async stat(filePath: string) {
    const stats = await this.filesystem.stat(filePath);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: Number(stats.size),
      mtime: stats.mtime,
    };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.filesystem.access(filePath);
      return true;
    } catch (error) {
      if (
        error instanceof DomainError ||
        (error instanceof Error && error.name === 'PathNotAllowedError')
      )
        throw error;
      return false;
    }
  }

  async write(filePath: string, content: string): Promise<void> {
    await this.atomicWrite(filePath, content);
  }

  async writeBuffer(filePath: string, content: Buffer): Promise<void> {
    await this.atomicWrite(filePath, content);
  }

  async readBuffer(filePath: string): Promise<Buffer> {
    return (await this.filesystem.readFile(filePath)) as Buffer;
  }

  private async atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
    const target = this.security.validateLocalPath(filePath, 'write file', false);
    const temporary = `${target}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    await this.filesystem.mkdir(path.dirname(target), { recursive: true });
    try {
      if (typeof content === 'string') await this.filesystem.writeFile(temporary, content, 'utf-8');
      else await this.filesystem.writeFile(temporary, content);
      await this.filesystem.rename(temporary, target);
    } catch (error) {
      await this.filesystem.rm(temporary).catch(() => {});
      throw error;
    }
  }

  async mkdir(directoryPath: string): Promise<void> {
    const target = this.security.validateLocalPath(directoryPath, 'create directory');
    try {
      const stats = await this.filesystem.lstat(target);
      if (stats.isDirectory() || stats.isSymbolicLink()) return;
      throw new ValidationDomainError('Path exists and is not a directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await this.filesystem.mkdir(target, { recursive: true });
  }

  async remove(filePath: string): Promise<void> {
    await this.filesystem.rm(filePath, { recursive: true });
  }

  async copy(sourcePath: string, destinationPath: string, overwrite: boolean): Promise<void> {
    const source = this.security.validateLocalPath(sourcePath, 'copy source');
    const destination = this.security.validateLocalPath(destinationPath, 'copy destination', false);
    this.validateDestination(source, destination, 'copy');
    const stats = await this.filesystem.stat(source);
    await this.prepareDestination(destination, overwrite);
    await this.filesystem.mkdir(path.dirname(destination), {
      recursive: true,
    });
    if (stats.isDirectory()) await this.copyDirectory(source, destination);
    else await this.filesystem.copyFile(source, destination);
  }

  async move(sourcePath: string, destinationPath: string, overwrite: boolean): Promise<void> {
    const source = this.security.validateLocalPath(sourcePath, 'move source', false);
    const destination = this.security.validateLocalPath(destinationPath, 'move destination', false);
    if (source === destination) return;
    this.validateDestination(source, destination, 'move');
    await this.filesystem.lstat(source);
    await this.prepareDestination(destination, overwrite);
    await this.filesystem.mkdir(path.dirname(destination), {
      recursive: true,
    });
    await this.filesystem.rename(source, destination);
  }

  private validateDestination(
    sourcePath: string,
    destinationPath: string,
    operation: string
  ): void {
    const source = path.resolve(sourcePath);
    const destination = path.resolve(destinationPath);
    if (destination === source || destination.startsWith(source + path.sep)) {
      throw new ValidationDomainError(
        `Cannot ${operation} a folder into itself or one of its own descendants`
      );
    }
  }

  private async prepareDestination(destinationPath: string, overwrite: boolean): Promise<void> {
    try {
      await this.filesystem.lstat(destinationPath);
      if (!overwrite) throw new ConflictDomainError('Destination already exists');
      await this.filesystem.rm(destinationPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    await this.filesystem.mkdir(destination, { recursive: true });
    for (const entry of await this.filesystem.readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) await this.copyDirectory(from, to);
      else await this.filesystem.copyFile(from, to);
    }
  }
}
