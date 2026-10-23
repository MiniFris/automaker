import { Injectable } from '@nestjs/common';
import * as secureFs from '../../lib/secure-fs.js';
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
}
