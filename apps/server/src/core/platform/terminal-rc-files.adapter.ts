import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  RC_FILE_VERSION,
  getTerminalDir,
  getRcFilePath,
  getThemesDir,
  generateCommonFunctions,
  generateBashrc,
  generateZshrc,
  generateThemeColors,
  type TerminalConfig,
  type TerminalTheme,
} from '@automaker/platform';
import type { ThemeMode } from '@automaker/types';
import type * as Filesystem from '../../lib/secure-fs.js';
import { UnavailableDomainError } from '../errors/domain-errors.js';

export interface TerminalRcFilesPort {
  ensure(
    projectPath: string,
    theme: ThemeMode,
    config: TerminalConfig,
    colors: TerminalTheme,
    allThemes: Record<ThemeMode, TerminalTheme>
  ): Promise<void>;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)])
    );
  return value;
}

/** Native app-owned RC IO. Pure generators retain the established RC format. */
export class TerminalRcFilesAdapter implements TerminalRcFilesPort {
  private readonly queues = new Map<string, Promise<void>>();
  private pending = 0;
  constructor(
    private readonly filesystem: Pick<
      typeof Filesystem,
      'readFile' | 'access' | 'mkdir' | 'writeFile' | 'rename' | 'rm'
    >
  ) {}

  ensure(
    project: string,
    theme: ThemeMode,
    config: TerminalConfig,
    colors: TerminalTheme,
    allThemes: Record<ThemeMode, TerminalTheme>
  ): Promise<void> {
    if (this.pending >= 256)
      return Promise.reject(new UnavailableDomainError('Terminal configuration queue is busy.'));
    this.pending++;
    const task = (this.queues.get(project) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.ensureInternal(project, theme, config, colors, allThemes));
    const tracked = task.finally(() => {
      this.pending--;
      if (this.queues.get(project) === tracked) this.queues.delete(project);
    });
    this.queues.set(project, tracked);
    return tracked;
  }

  private async optionalRead(file: string): Promise<string | undefined> {
    try {
      return (await this.filesystem.readFile(file, 'utf8')) as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async write(file: string, content: string): Promise<void> {
    const temporary = `${file}.tmp.${randomUUID()}`;
    let cleanup = true;
    let written = false;
    try {
      await this.filesystem.writeFile(temporary, content, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      written = true;
      await this.filesystem.rename(temporary, file);
    } catch (error) {
      // Exclusive-create collision is not an owned temporary file.
      if (!written && (error as NodeJS.ErrnoException).code === 'EEXIST') cleanup = false;
      throw error;
    } finally {
      if (cleanup) await this.filesystem.rm(temporary, { force: true });
    }
  }

  private async ensureInternal(
    project: string,
    theme: ThemeMode,
    config: TerminalConfig,
    colors: TerminalTheme,
    allThemes: Record<ThemeMode, TerminalTheme>
  ): Promise<void> {
    const directory = getTerminalDir(project),
      themes = getThemesDir(project);
    const versionFile = path.join(directory, 'version.txt'),
      signatureFile = path.join(directory, 'config.sha256');
    const signature = createHash('sha256')
      .update(JSON.stringify({ theme, config: sorted(config) }))
      .digest('hex');
    let regenerate =
      Number.parseInt((await this.optionalRead(versionFile)) ?? '', 10) !== RC_FILE_VERSION;
    if (!regenerate) regenerate = (await this.optionalRead(signatureFile))?.trim() !== signature;
    if (!regenerate) {
      for (const file of [
        getRcFilePath(project, 'bash'),
        getRcFilePath(project, 'zsh'),
        path.join(directory, 'common.sh'),
        path.join(themes, `${theme}.sh`),
      ]) {
        try {
          await this.filesystem.access(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          regenerate = true;
          break;
        }
      }
    }
    if (!regenerate) return;
    await this.filesystem.mkdir(directory, { recursive: true, mode: 0o700 });
    await this.filesystem.mkdir(themes, { recursive: true, mode: 0o700 });
    await this.write(path.join(directory, 'common.sh'), generateCommonFunctions(config));
    await this.write(getRcFilePath(project, 'bash'), generateBashrc(colors, config));
    await this.write(getRcFilePath(project, 'zsh'), generateZshrc(colors, config));
    for (const [name, value] of Object.entries(allThemes))
      await this.write(path.join(themes, `${name}.sh`), generateThemeColors(value));
    await this.write(versionFile, `${RC_FILE_VERSION}\n`);
    await this.write(signatureFile, `${signature}\n`);
  }
}
