import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import { SettingsService } from '../../../src/services/settings-service.js';
import { SettingsFileRepository } from '../../../src/modules/settings/settings-file.repository.js';
import type * as Filesystem from '../../../src/lib/secure-fs.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(automatic = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-import-barrier-'));
  roots.push(root);
  const filesystem = secureFs.createSecureFs((candidate) => {
    const absolute = path.resolve(candidate),
      relative = path.relative(root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('outside fixture');
    return absolute;
  });
  const importer = {
    migrate: vi
      .fn()
      .mockResolvedValue({ migrated: false, migratedFiles: [], legacyPath: '', errors: [] }),
  };
  const service = new SettingsService(
    root,
    new SettingsFileRepository(filesystem as unknown as typeof Filesystem, path.resolve, true),
    importer,
    automatic
  );
  return { root, filesystem, importer, service };
}
it('gates concurrent native reads and mutations until one import publishes its original settings', async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.importer.migrate.mockImplementation(async () => {
    await held;
    await f.filesystem.writeFile(
      path.join(f.root, 'settings.json'),
      '{"theme":"light","language":"ru"}',
      { mode: 0o600 }
    );
    return { migrated: true, migratedFiles: ['settings.json'], legacyPath: '', errors: [] };
  });
  const changed = f.service.updateGlobalSettings({ theme: 'dark' }),
    read = f.service.getGlobalSettings(),
    credentials = f.service.getCredentials();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.importer.migrate).toHaveBeenCalledOnce();
  await expect(fs.access(path.join(f.root, 'settings.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  release();
  await Promise.all([changed, read, credentials]);
  const stored = JSON.parse(await fs.readFile(path.join(f.root, 'settings.json'), 'utf8'));
  expect(stored.theme).toBe('dark');
  expect(stored.language).toBe('ru');
  expect(f.importer.migrate).toHaveBeenCalledOnce();
  await f.service.beforeApplicationShutdown();
  await f.filesystem.close();
});
it('never turns importer errors into repository defaults or successful mutation', async () => {
  const f = await fixture();
  f.importer.migrate.mockResolvedValue({
    migrated: false,
    migratedFiles: [],
    legacyPath: '',
    errors: ['incomplete'],
  });
  await expect(f.service.getGlobalSettings()).rejects.toThrow(
    'Legacy profile import is incomplete'
  );
  await expect(f.service.updateGlobalSettings({ theme: 'dark' })).rejects.toThrow(
    'Legacy profile import is incomplete'
  );
  expect(await fs.readdir(f.root)).toEqual([]);
  f.importer.migrate.mockResolvedValue({
    migrated: false,
    migratedFiles: [],
    legacyPath: '',
    errors: [],
  });
  await expect(f.service.getGlobalSettings()).resolves.toHaveProperty('theme');
  await f.service.beforeApplicationShutdown();
  await f.filesystem.close();
});
it('preserves disabled startup tasks until migration is explicitly requested', async () => {
  const f = await fixture(false);
  await f.service.getGlobalSettings();
  expect(f.importer.migrate).not.toHaveBeenCalled();
  await f.service.migrateFromLegacyElectronPath();
  expect(f.importer.migrate).toHaveBeenCalledOnce();
  await f.service.beforeApplicationShutdown();
  await f.filesystem.close();
});
