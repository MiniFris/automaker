import { Injectable } from '@nestjs/common';
import * as secureFs from '../../lib/secure-fs.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSafe } from '@automaker/utils';
import { ConflictDomainError, ValidationDomainError } from '../../core/errors/index.js';
import type { ProjectFilePort } from './project-file.port.js';

@Injectable()
export class LocalProjectFileAdapter implements ProjectFilePort {
  async read(filePath: string): Promise<string> {
    return (await secureFs.readFile(filePath, 'utf-8')) as string;
  }

  async list(directoryPath: string) {
    return (await secureFs.readdir(directoryPath, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  async stat(filePath: string) {
    const stats = await secureFs.stat(filePath);
    return {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: Number(stats.size),
      mtime: stats.mtime,
    };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await secureFs.access(filePath);
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'PathNotAllowedError') throw error;
      return false;
    }
  }

  async write(filePath: string, content: string): Promise<void> {
    const target = path.resolve(filePath);
    const temporary = `${target}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    await mkdirSafe(path.dirname(target));
    try {
      await secureFs.writeFile(temporary, content, 'utf-8');
      await secureFs.rename(temporary, target);
    } catch (error) {
      await secureFs.rm(temporary).catch(() => {});
      throw error;
    }
  }

  async mkdir(directoryPath: string): Promise<void> {
    const target = path.resolve(directoryPath);
    try {
      const stats = await secureFs.lstat(target);
      if (stats.isDirectory() || stats.isSymbolicLink()) return;
      throw new ValidationDomainError('Path exists and is not a directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await secureFs.mkdir(target, { recursive: true });
  }

  async remove(filePath: string): Promise<void> {
    await secureFs.rm(filePath, { recursive: true });
  }

  async copy(sourcePath: string, destinationPath: string, overwrite: boolean): Promise<void> {
    this.validateDestination(sourcePath, destinationPath, 'copy');
    await this.prepareDestination(destinationPath, overwrite);
    await mkdirSafe(path.dirname(path.resolve(destinationPath)));
    const stats = await secureFs.stat(sourcePath);
    if (stats.isDirectory()) await this.copyDirectory(sourcePath, destinationPath);
    else await secureFs.copyFile(sourcePath, destinationPath);
  }

  async move(sourcePath: string, destinationPath: string, overwrite: boolean): Promise<void> {
    const source = path.resolve(sourcePath);
    const destination = path.resolve(destinationPath);
    if (source === destination) return;
    this.validateDestination(sourcePath, destinationPath, 'move');
    await this.prepareDestination(destinationPath, overwrite);
    await mkdirSafe(path.dirname(destination));
    await secureFs.rename(sourcePath, destinationPath);
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
      await secureFs.stat(destinationPath);
      if (!overwrite) throw new ConflictDomainError('Destination already exists');
      await secureFs.rm(destinationPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    await mkdirSafe(destination);
    for (const entry of await secureFs.readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) await this.copyDirectory(from, to);
      else await secureFs.copyFile(from, to);
    }
  }
}
