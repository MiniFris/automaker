import { Injectable } from '@nestjs/common';
import { atomicWriteJson, createLogger, DEFAULT_BACKUP_COUNT } from '@automaker/utils';

import * as secureFs from '../../lib/secure-fs.js';

const logger = createLogger('SettingsFileRepository');

/** File boundary shared by global, project and credential settings stores. */
@Injectable()
export class SettingsFileRepository {
  async read<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
      const content = (await secureFs.readFile(filePath, 'utf-8')) as string;
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Error reading ${filePath}:`, error);
      }
      return defaultValue;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await secureFs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async write(filePath: string, data: unknown, privateFile = false): Promise<void> {
    await atomicWriteJson(filePath, data, {
      backupCount: DEFAULT_BACKUP_COUNT,
      ...(privateFile && { mode: 0o600 }),
    });
  }
}
