import { atomicWriteJson, createLogger, DEFAULT_BACKUP_COUNT } from '@automaker/utils';
import path from 'node:path';

import * as secureFs from '../../lib/secure-fs.js';

const logger = createLogger('SettingsFileRepository');

/** File boundary shared by global, project and credential settings stores. */
export class SettingsFileRepository {
  private initialize?: () => Promise<void>;
  setInitializationBarrier(initialize: () => Promise<void>): void {
    this.initialize = initialize;
  }
  constructor(
    private readonly filesystem: typeof secureFs = secureFs,
    private readonly canonicalize: (candidate: string) => string = path.resolve,
    readonly scoped = false
  ) {}

  directory(candidate: string): string {
    return this.canonicalize(candidate);
  }

  async ensureDirectory(candidate: string): Promise<void> {
    await this.initialize?.();
    await this.filesystem.mkdir(this.directory(candidate), {
      recursive: true,
      ...(this.scoped && { mode: 0o700 }),
    });
  }

  async read<T>(filePath: string, defaultValue: T, strict = false): Promise<T> {
    await this.initialize?.();
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
    await this.initialize?.();
    try {
      await this.filesystem.access(filePath);
      return true;
    } catch (error) {
      if (this.scoped && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  }

  async write(filePath: string, data: unknown, privateFile = false): Promise<void> {
    await this.initialize?.();
    await atomicWriteJson(filePath, data, {
      backupCount: DEFAULT_BACKUP_COUNT,
      filesystem: this.filesystem,
      ...((privateFile || this.scoped) && { mode: 0o600 }),
    });
  }
}
