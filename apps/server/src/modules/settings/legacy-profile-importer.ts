import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicWriteJson } from '@automaker/utils';
import { RuntimePathsService } from '../../core/config/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import {
  LegacyElectronProfileSource,
  LEGACY_PROFILE_ITEMS,
} from '../../core/platform/legacy-electron-profile.source.js';
import type * as Filesystem from '../../lib/secure-fs.js';

export interface LegacyProfileImportResult {
  migrated: boolean;
  migratedFiles: string[];
  legacyPath: string;
  errors: string[];
}
interface ImportFile {
  relative: string;
  hash: string;
}
interface ImportIntent {
  version: 1;
  source: string;
  phase: 'staging' | 'publishing' | 'complete';
  directories: string[];
  files: ImportFile[];
  skipped: string[];
}
const RESERVED = '.legacy-electron-import';
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const validRelative = (value: unknown): value is string =>
  typeof value === 'string' &&
  LEGACY_PROFILE_ITEMS.includes(value.split('/')[0] as (typeof LEGACY_PROFILE_ITEMS)[number]) &&
  value.split('/').every((part) => !!part && part !== '.' && part !== '..' && !/[\\\0]/.test(part));

/** Staged, resumable publication. Destination files are linked atomically without overwrite. */
@Injectable()
export class LegacyProfileImporter {
  private readonly destination: string;
  private pending?: Promise<LegacyProfileImportResult>;
  private stopping = false;
  private shutdown?: Promise<void>;

  constructor(
    @Inject(LegacyElectronProfileSource) private readonly source: LegacyElectronProfileSource,
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof Filesystem,
    @Inject(RuntimePathsService) paths: RuntimePathsService,
    @Inject(SecurityService) security: SecurityService
  ) {
    this.destination = security.validateLocalPath(paths.dataDirectory, 'legacy import destination');
  }

  migrate(): Promise<LegacyProfileImportResult> {
    if (this.stopping)
      return Promise.resolve(this.result(false, [], ['Legacy profile import is shutting down.']));
    if (this.pending) return this.pending;
    const operation = this.run().catch(() =>
      this.result(false, [], ['Legacy profile import is incomplete; retry with the same profile.'])
    );
    this.pending = operation;
    void operation.finally(() => {
      if (this.pending === operation) this.pending = undefined;
    });
    return operation;
  }

  private result(
    migrated: boolean,
    migratedFiles: string[] = [],
    errors: string[] = []
  ): LegacyProfileImportResult {
    return { migrated, migratedFiles, legacyPath: this.source.directory ?? '', errors };
  }

  private async checked(relative: string): Promise<string> {
    if (this.stopping) throw new Error('Legacy profile import is stopping.');
    let current = this.destination;
    for (const part of ['', ...relative.split('/').filter(Boolean)]) {
      current = path.join(current, part);
      try {
        if ((await this.filesystem.lstat(current)).isSymbolicLink())
          throw new Error('Import destination contains a symbolic link.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return current;
  }

  private async exists(relative: string): Promise<boolean> {
    try {
      await this.filesystem.lstat(await this.checked(relative));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async save(intent: ImportIntent): Promise<void> {
    await atomicWriteJson(await this.checked(`${RESERVED}/intent.json`), intent, {
      filesystem: this.filesystem,
      mode: 0o600,
    });
  }

  private async load(): Promise<ImportIntent | undefined> {
    if (!(await this.exists(RESERVED))) return undefined;
    if (!(await this.exists(`${RESERVED}/intent.json`))) {
      if ((await this.filesystem.readdir(await this.checked(RESERVED))).length)
        throw new Error('Unrecognized import storage.');
      return undefined;
    }
    const value = JSON.parse(
      String(await this.filesystem.readFile(await this.checked(`${RESERVED}/intent.json`), 'utf8'))
    ) as ImportIntent;
    if (
      !value ||
      value.version !== 1 ||
      typeof value.source !== 'string' ||
      !path.isAbsolute(value.source) ||
      (value.phase === 'staging' && value.source !== this.source.directory) ||
      !['staging', 'publishing', 'complete'].includes(value.phase) ||
      !Array.isArray(value.directories) ||
      !value.directories.every(validRelative) ||
      !Array.isArray(value.files) ||
      !value.files.every(
        (file) =>
          file &&
          validRelative(file.relative) &&
          typeof file.hash === 'string' &&
          /^[a-f0-9]{64}$/.test(file.hash)
      ) ||
      !Array.isArray(value.skipped) ||
      !value.skipped.every((item) =>
        LEGACY_PROFILE_ITEMS.includes(item as (typeof LEGACY_PROFILE_ITEMS)[number])
      )
    )
      throw new Error('Import intent is unavailable.');
    return value;
  }

  private async run(): Promise<LegacyProfileImportResult> {
    let intent = await this.load();
    if (intent?.phase === 'complete') {
      await this.filesystem.rm(await this.checked(`${RESERVED}/payload`), {
        recursive: true,
        force: true,
      });
      return { ...this.result(false), legacyPath: intent.source };
    }
    if (!intent && (await this.exists('settings.json'))) return this.result(false);
    if (!this.source.directory && intent?.phase !== 'publishing') {
      if (intent) throw new Error('Legacy source identity is unavailable.');
      await this.source.inventory(); // Distinguish absent host config from invalid config.
      return this.result(false);
    }
    if (!intent && path.resolve(this.source.directory!) === this.destination)
      return this.result(false);
    if (!intent || intent.phase === 'staging') {
      const entries = await this.source.inventory();
      if (!entries) {
        if (intent) throw new Error('Legacy source disappeared during import.');
        return this.result(false);
      }
      const inside = path.relative(this.source.canonicalDirectory!, this.destination);
      if (!inside) {
        if (intent) throw new Error('Pending import overlaps its source.');
        return this.result(false);
      }
      if (inside !== '..' && !inside.startsWith(`..${path.sep}`) && !path.isAbsolute(inside))
        throw new Error('Import destination is inside the legacy source.');
      // Capture the original skip set before any destination publication.
      const skipped = intent?.skipped ?? [];
      if (!intent)
        for (const item of LEGACY_PROFILE_ITEMS) if (await this.exists(item)) skipped.push(item);
      intent = {
        version: 1,
        source: this.source.directory!,
        phase: 'staging',
        directories: [],
        files: [],
        skipped,
      };
      await this.filesystem.mkdir(await this.checked(''), { recursive: true, mode: 0o700 });
      await this.filesystem.mkdir(await this.checked(RESERVED), { recursive: true, mode: 0o700 });
      await this.save(intent);
      const payload = `${RESERVED}/payload`;
      await this.filesystem.rm(await this.checked(payload), { recursive: true, force: true });
      await this.filesystem.mkdir(await this.checked(payload), { recursive: true, mode: 0o700 });
      for (const entry of entries) {
        if (!validRelative(entry.relative)) throw new Error('Invalid source manifest.');
        if (skipped.includes(entry.relative.split('/')[0])) continue;
        const staged = await this.checked(`${payload}/${entry.relative}`);
        if (entry.directory) {
          await this.filesystem.mkdir(staged, { recursive: true, mode: 0o700 });
          intent.directories.push(entry.relative);
        } else {
          const bytes = await this.source.read(entry.relative);
          if (
            ['settings.json', 'credentials.json', 'sessions-metadata.json'].includes(entry.relative)
          ) {
            const value: unknown = JSON.parse(bytes.toString('utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value))
              throw new Error('Legacy profile JSON is unavailable.');
          }
          await this.filesystem.mkdir(
            await this.checked(path.posix.dirname(`${payload}/${entry.relative}`)),
            { recursive: true, mode: 0o700 }
          );
          await this.filesystem.writeFile(staged, bytes, { flag: 'wx', mode: 0o600 });
          intent.files.push({ relative: entry.relative, hash: digest(bytes) });
        }
      }
      if (
        !intent.files.some((file) => file.relative === 'settings.json') &&
        !skipped.includes('settings.json')
      )
        throw new Error('Legacy settings disappeared during staging.');
      intent.phase = 'publishing';
      await this.save(intent);
    }
    for (const relative of intent.directories)
      await this.filesystem.mkdir(await this.checked(relative), { recursive: true, mode: 0o700 });
    // A crash after publishing another item must not make settings.json suppress recovery.
    const files = [...intent.files].sort(
      (a, b) =>
        Number(a.relative === 'settings.json') - Number(b.relative === 'settings.json') ||
        a.relative.localeCompare(b.relative)
    );
    const migrated = new Set<string>();
    for (const file of files) {
      const staged = await this.checked(`${RESERVED}/payload/${file.relative}`);
      if (digest((await this.filesystem.readFile(staged)) as Buffer) !== file.hash)
        throw new Error('Staged legacy payload changed.');
      const destination = await this.checked(file.relative);
      try {
        await this.filesystem.link(staged, destination);
        migrated.add(file.relative.split('/')[0]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // A prior publication or a newly-created destination is authoritative.
        await this.checked(file.relative);
      }
    }
    intent.phase = 'complete';
    await this.save(intent);
    await this.filesystem.rm(await this.checked(`${RESERVED}/payload`), {
      recursive: true,
      force: true,
    });
    return {
      ...this.result(
        migrated.size > 0,
        [...migrated].map((item) => (intent!.directories.includes(item) ? `${item}/` : item))
      ),
      legacyPath: intent.source,
    };
  }

  onModuleDestroy(): Promise<void> {
    this.stopping = true;
    return (this.shutdown ??= (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('Legacy import cleanup could not be confirmed.')),
              5000
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })());
  }
}
