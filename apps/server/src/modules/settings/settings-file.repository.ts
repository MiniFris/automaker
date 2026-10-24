import { Injectable } from '@nestjs/common';
import { atomicWriteJson, createLogger, DEFAULT_BACKUP_COUNT } from '@automaker/utils';
import path from 'node:path';

import * as secureFs from '../../lib/secure-fs.js';

const logger = createLogger('SettingsFileRepository');

/** File boundary shared by global, project and credential settings stores. */
@Injectable()
export class SettingsFileRepository {
  constructor(
    private readonly filesystem: typeof secureFs = secureFs,
    private readonly canonicalize: (candidate: string) => string = path.resolve,
    readonly scoped = false
  ) {}

  directory(candidate: string): string {
    return this.canonicalize(candidate);
  }

  async ensureDirectory(candidate: string): Promise<void> {
    await this.filesystem.mkdir(this.directory(candidate), { recursive: true });
  }

  async read<T>(filePath: string, defaultValue: T, strict = false): Promise<T> {
    try {
      const content = (await this.filesystem.readFile(filePath, 'utf-8')) as string;
      return JSON.parse(content) as T;
    } catch (error) {
      if (
        this.scoped &&
        !(error instanceof SyntaxError) &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      )
        throw error;
      if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Private settings are unavailable.');
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Error reading ${filePath}:`, error);
      }
      return defaultValue;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.filesystem.access(filePath);
      return true;
    } catch (error) {
      if (this.scoped && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }

  async write(filePath: string, data: unknown, privateFile = false): Promise<void> {
    await atomicWriteJson(filePath, data, {
      backupCount: DEFAULT_BACKUP_COUNT,
      filesystem: this.filesystem,
      ...(privateFile && { mode: 0o600 }),
    });
  }
}
