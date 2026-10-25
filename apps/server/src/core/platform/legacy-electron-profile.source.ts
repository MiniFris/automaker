import { Inject, Injectable } from '@nestjs/common';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { HOST_ENVIRONMENT, HOST_PROFILE_CONFIG, type HostProfileConfig } from '../config/index.js';

export const LEGACY_PROFILE_ITEMS = [
  'credentials.json',
  'sessions-metadata.json',
  'agent-sessions',
  '.api-key',
  '.sessions',
  'settings.json',
] as const;
export interface LegacyProfileEntry {
  relative: string;
  directory: boolean;
}

export function resolveLegacyProfileDirectory(
  config: HostProfileConfig,
  environment: Readonly<NodeJS.ProcessEnv>
): string | undefined {
  const paths = config.platform === 'win32' ? path.win32 : path.posix;
  const home = config.homeDirectory;
  const base =
    config.platform === 'win32'
      ? environment.APPDATA || (home && paths.join(home, 'AppData', 'Roaming'))
      : config.platform === 'darwin'
        ? home && paths.join(home, 'Library', 'Application Support')
        : environment.XDG_CONFIG_HOME || (home && paths.join(home, '.config'));
  if (!base) return undefined;
  if (!paths.isAbsolute(base)) throw new Error('Legacy profile configuration must be absolute.');
  return paths.join(base, 'Automaker');
}

/** Narrow host read capability; destination writes belong to the native filesystem. */
export abstract class LegacyElectronProfileSource {
  abstract readonly directory: string | undefined;
  get canonicalDirectory(): string | undefined {
    return this.directory;
  }
  abstract inventory(): Promise<LegacyProfileEntry[] | undefined>;
  abstract read(relative: string): Promise<Buffer>;
}

@Injectable()
export class NodeLegacyElectronProfileSource extends LegacyElectronProfileSource {
  readonly directory: string | undefined;
  private root?: string;
  private identity?: { dev: number; ino: number };
  private invalidConfiguration = false;
  override get canonicalDirectory(): string | undefined {
    return this.root ?? this.directory;
  }

  constructor(
    @Inject(HOST_PROFILE_CONFIG) config: HostProfileConfig,
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>
  ) {
    super();
    try {
      this.directory = resolveLegacyProfileDirectory(config, environment);
    } catch {
      this.invalidConfiguration = true;
    }
  }

  private relative(value: string): void {
    const parts = value.split('/');
    if (
      !parts.length ||
      !LEGACY_PROFILE_ITEMS.includes(parts[0] as (typeof LEGACY_PROFILE_ITEMS)[number]) ||
      parts.some(
        (part) =>
          !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')
      )
    )
      throw new Error('Unsupported legacy profile item.');
  }

  private async checked(relative: string): Promise<string> {
    this.relative(relative);
    if (!this.directory || !this.root) throw new Error('Legacy profile is unavailable.');
    const root = await fs.lstat(this.directory);
    if (
      root.isSymbolicLink() ||
      root.dev !== this.identity?.dev ||
      root.ino !== this.identity?.ino ||
      (await fs.realpath(this.directory)) !== this.root
    )
      throw new Error('Legacy profile identity changed.');
    let current = this.root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error('Legacy profile contains a symbolic link.');
    }
    const canonical = await fs.realpath(current);
    const inside = path.relative(this.root, canonical);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
      throw new Error('Legacy profile path escaped its root.');
    return canonical;
  }

  async inventory(): Promise<LegacyProfileEntry[] | undefined> {
    if (this.invalidConfiguration) throw new Error('Legacy profile configuration is unavailable.');
    if (!this.directory) return undefined;
    let root;
    try {
      root = await fs.lstat(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (root.isSymbolicLink() || !root.isDirectory())
      throw new Error('Legacy profile is not a regular directory.');
    const canonical = await fs.realpath(this.directory);
    if (this.root && this.root !== canonical) throw new Error('Legacy profile identity changed.');
    this.root = canonical;
    if (this.identity && (this.identity.dev !== root.dev || this.identity.ino !== root.ino))
      throw new Error('Legacy profile identity changed.');
    this.identity = { dev: root.dev, ino: root.ino };
    try {
      if (!(await fs.lstat(await this.checked('settings.json'))).isFile())
        throw new Error('Legacy settings are not a regular file.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const entries: LegacyProfileEntry[] = [];
    const walk = async (relative: string): Promise<void> => {
      const file = await this.checked(relative),
        stat = await fs.lstat(file);
      if (!stat.isFile() && !stat.isDirectory())
        throw new Error('Unsupported legacy profile file type.');
      entries.push({ relative, directory: stat.isDirectory() });
      if (stat.isDirectory())
        for (const name of (await fs.readdir(file)).sort()) await walk(`${relative}/${name}`);
    };
    for (const item of LEGACY_PROFILE_ITEMS) {
      try {
        await fs.lstat(path.join(canonical, item));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        continue;
      }
      await walk(item);
    }
    return entries;
  }

  async read(relative: string): Promise<Buffer> {
    const file = await this.checked(relative);
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat(),
        checked = await this.checked(relative),
        current = await fs.lstat(checked);
      if (!stat.isFile() || current.ino !== stat.ino || current.dev !== stat.dev)
        throw new Error('Legacy profile file identity changed.');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
}
