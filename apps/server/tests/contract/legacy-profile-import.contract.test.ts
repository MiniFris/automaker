import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';
import { LegacyProfileImporter } from '../../src/modules/settings/legacy-profile-importer.js';
import { AgentService } from '../../src/services/agent-service.js';

describe('native legacy Electron profile import', () => {
  let root: string;
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-legacy-profile-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map(({ app }) => app.close()));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function owner(
    name = 'one',
    configuration = path.join(root, 'host-config'),
    destination?: string
  ) {
    const directory = path.join(root, name),
      data = destination ?? path.join(directory, 'data');
    await fs.mkdir(directory, { recursive: true });
    const runtime = await createNestApplication({
      workingDirectory: directory,
      dataDir: data,
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
      environment: {
        NODE_ENV: 'test',
        HOME: path.join(root, 'owned-home'),
        XDG_CONFIG_HOME: configuration,
        AUTOMAKER_API_KEY: 'fixture',
        ALLOWED_ROOT_DIRECTORY: directory,
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    apps.push(runtime);
    return {
      ...runtime,
      data,
      settings: runtime.app.get(SettingsService),
      filesystem: runtime.app.get<typeof Filesystem>(SECURE_FILESYSTEM),
    };
  }
  async function profile() {
    const directory = path.join(root, 'host-config', 'Automaker');
    await fs.mkdir(path.join(directory, 'agent-sessions'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'settings.json'),
      JSON.stringify({ theme: 'light', fixture: 'original' })
    );
    await fs.writeFile(
      path.join(directory, 'credentials.json'),
      JSON.stringify({ version: 2, apiKeys: {} })
    );
    await fs.writeFile(path.join(directory, 'sessions-metadata.json'), '{}');
    await fs.writeFile(path.join(directory, 'agent-sessions', 'session.json'), '[]');
    await fs.writeFile(path.join(directory, 'agent-sessions', 'session-queue.json'), '[]');
    await fs.mkdir(path.join(directory, 'GPU Cache'));
    await fs.writeFile(path.join(directory, 'GPU Cache', 'must-not-copy'), 'cache');
    return directory;
  }
  const intent = async (data: string) =>
    JSON.parse(
      await fs.readFile(path.join(data, '.legacy-electron-import', 'intent.json'), 'utf8')
    );

  it('reads only the configured host profile outside allowed root and writes private native files without changing source', async () => {
    const source = await profile(),
      app = await owner();
    const original = await fs.readFile(path.join(source, 'settings.json'));
    const result = await app.settings.migrateFromLegacyElectronPath();
    expect(result.errors).toEqual([]);
    expect(result.migrated).toBe(true);
    expect(result.migratedFiles).toContain('agent-sessions/');
    expect(await fs.readFile(path.join(app.data, 'settings.json'))).toEqual(original);
    expect(await fs.readFile(path.join(source, 'settings.json'))).toEqual(original);
    await expect(fs.access(path.join(app.data, 'GPU Cache'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await intent(app.data)).phase).toBe('complete');
    await expect(
      fs.access(path.join(app.data, '.legacy-electron-import', 'payload'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await app.settings.getGlobalSettings();
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(app.data, 'settings.json'))).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.join(app.data, 'agent-sessions'))).mode & 0o777).toBe(0o700);
    }
  });

  it('preserves existing destination items and skips a pre-existing settings profile', async () => {
    await profile();
    const first = await owner();
    await fs.mkdir(first.data, { recursive: true });
    await fs.writeFile(path.join(first.data, 'credentials.json'), 'existing-credentials');
    await fs.mkdir(path.join(first.data, 'agent-sessions'));
    await fs.writeFile(path.join(first.data, 'agent-sessions', 'existing'), 'retained');
    expect((await first.settings.migrateFromLegacyElectronPath()).errors).toEqual([]);
    expect(await fs.readFile(path.join(first.data, 'credentials.json'), 'utf8')).toBe(
      'existing-credentials'
    );
    expect(await fs.readdir(path.join(first.data, 'agent-sessions'))).toEqual(['existing']);
    const second = await owner('two');
    await fs.mkdir(second.data, { recursive: true });
    await fs.writeFile(path.join(second.data, 'settings.json'), '{"theme":"dark"}');
    expect((await second.settings.migrateFromLegacyElectronPath()).migrated).toBe(false);
    await expect(fs.access(path.join(second.data, 'credentials.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('coalesces calls and safely resumes a partially published directory after process replacement', async () => {
    const originalSource = await profile();
    const first = await owner();
    const link = first.filesystem.link.bind(first.filesystem);
    const fail = vi
      .spyOn(first.filesystem, 'link')
      .mockImplementation(async (source, destination) => {
        if (destination.endsWith('session.json'))
          throw Object.assign(new Error('private-copy-fixture'), { code: 'EIO' });
        return link(source, destination);
      });
    const one = first.settings.migrateFromLegacyElectronPath(),
      two = first.settings.migrateFromLegacyElectronPath();
    expect(one).toBe(two);
    expect((await one).errors).toEqual([
      'Legacy profile import is incomplete; retry with the same profile.',
    ]);
    expect((await intent(first.data)).phase).toBe('publishing');
    await expect(first.settings.getGlobalSettings()).rejects.toThrow(
      'Legacy profile import is incomplete'
    );
    await expect(fs.access(path.join(first.data, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    fail.mockRestore();
    await first.app.close();
    await fs.rename(originalSource, `${originalSource}-archived`);
    const restarted = await owner('one', path.join(root, 'new-host-config'));
    const recovered = await restarted.settings.migrateFromLegacyElectronPath();
    expect(recovered.errors).toEqual([]);
    expect(recovered.legacyPath).toBe(originalSource);
    expect(await fs.readdir(path.join(restarted.data, 'agent-sessions'))).toEqual([
      'session-queue.json',
      'session.json',
    ]);
    expect((await intent(restarted.data)).phase).toBe('complete');
  });

  it('finishes a pending intent even when settings.json was published before a failed commit', async () => {
    await profile();
    const app = await owner(),
      rename = app.filesystem.rename.bind(app.filesystem);
    const fail = vi
      .spyOn(app.filesystem, 'rename')
      .mockImplementation(async (source, destination) => {
        if (
          destination.endsWith('intent.json') &&
          JSON.parse(await fs.readFile(source, 'utf8')).phase === 'complete'
        )
          throw Object.assign(new Error('private-commit-fixture'), { code: 'EIO' });
        return rename(source, destination);
      });
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    const published = await fs.readFile(path.join(app.data, 'settings.json'));
    expect((await intent(app.data)).phase).toBe('publishing');
    await expect(app.settings.getGlobalSettings()).rejects.toThrow(
      'Legacy profile import is incomplete'
    );
    fail.mockRestore();
    expect((await app.settings.migrateFromLegacyElectronPath()).errors).toEqual([]);
    expect((await intent(app.data)).phase).toBe('complete');
    expect(await fs.readFile(path.join(app.data, 'settings.json'))).toEqual(published);
  });

  it('keeps staging failures retryable without creating defaults or incomplete destination files', async () => {
    await profile();
    const app = await owner(),
      write = app.filesystem.writeFile.bind(app.filesystem);
    const fail = vi.spyOn(app.filesystem, 'writeFile').mockImplementation(async (file, ...args) => {
      if (file.includes(`${path.sep}payload${path.sep}`) && file.endsWith('session.json'))
        throw new Error('private-stage-fixture');
      return write(file, ...args);
    });
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    expect((await intent(app.data)).phase).toBe('staging');
    await expect(app.settings.updateGlobalSettings({ theme: 'dark' })).rejects.toThrow(
      'Legacy profile import is incomplete'
    );
    await expect(fs.access(path.join(app.data, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    fail.mockRestore();
    expect((await app.settings.migrateFromLegacyElectronPath()).errors).toEqual([]);
  });

  it('rejects source symlink escape before publishing any settings and never reads its target', async () => {
    const source = await profile(),
      outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret'), 'private-outside-fixture');
    await fs.rm(path.join(source, 'agent-sessions'), { recursive: true });
    await fs.symlink(
      outside,
      path.join(source, 'agent-sessions'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const app = await owner();
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    await expect(fs.access(path.join(app.data, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(path.join(outside, 'secret'), 'utf8')).toBe('private-outside-fixture');
  });

  it('rejects destination symlinks and unknown journal formats instead of overwriting or skipping', async () => {
    await profile();
    const app = await owner(),
      outside = path.join(root, 'outside.json');
    await fs.writeFile(outside, 'retained');
    await fs.mkdir(app.data, { recursive: true });
    await fs.symlink(outside, path.join(app.data, 'credentials.json'));
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    expect(await fs.readFile(outside, 'utf8')).toBe('retained');
    await fs.unlink(path.join(app.data, 'credentials.json'));
    await fs.mkdir(path.join(app.data, '.legacy-electron-import'));
    await fs.writeFile(
      path.join(app.data, '.legacy-electron-import', 'intent.json'),
      '{"version":999}'
    );
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    await expect(app.settings.getGlobalSettings()).rejects.toThrow(
      'Legacy profile import is incomplete'
    );
  });

  it('reports invalid source config and unsupported hard links without an unsafe fallback', async () => {
    const invalid = await owner('invalid', 'relative-profile');
    expect((await invalid.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    await profile();
    const app = await owner();
    vi.spyOn(app.filesystem, 'link').mockRejectedValue(
      Object.assign(new Error('unsupported'), { code: 'ENOTSUP' })
    );
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    await expect(fs.access(path.join(app.data, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses import admission after its owning application closes', async () => {
    await profile();
    const app = await owner();
    await app.app.close();
    expect((await app.app.get(LegacyProfileImporter).migrate()).errors).toEqual([
      'Legacy profile import is shutting down.',
    ]);
  });

  it('preserves a file created between the original skip check and atomic publication', async () => {
    await profile();
    const app = await owner(),
      link = app.filesystem.link.bind(app.filesystem);
    vi.spyOn(app.filesystem, 'link').mockImplementation(async (source, destination) => {
      if (destination.endsWith('credentials.json'))
        await fs.writeFile(destination, 'concurrent-owner', { flag: 'wx' });
      return link(source, destination);
    });
    expect((await app.settings.migrateFromLegacyElectronPath()).errors).toEqual([]);
    expect(await fs.readFile(path.join(app.data, 'credentials.json'), 'utf8')).toBe(
      'concurrent-owner'
    );
  });

  it('retries private payload cleanup after a completed publication without falsely reporting success', async () => {
    await profile();
    const app = await owner(),
      remove = app.filesystem.rm.bind(app.filesystem);
    const fail = vi.spyOn(app.filesystem, 'rm').mockImplementation(async (file, options) => {
      if (
        file.endsWith('payload') &&
        (await intent(app.data).then(
          (record) => record.phase === 'complete',
          () => false
        ))
      )
        throw new Error('private-cleanup-fixture');
      return remove(file, options);
    });
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    expect((await intent(app.data)).phase).toBe('complete');
    await expect(app.settings.getGlobalSettings()).rejects.toThrow(
      'Legacy profile import is incomplete'
    );
    fail.mockRestore();
    expect((await app.settings.migrateFromLegacyElectronPath()).errors).toEqual([]);
    await expect(
      fs.access(path.join(app.data, '.legacy-electron-import', 'payload'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a malformed legacy settings payload in staging until the source is corrected', async () => {
    const source = await profile(),
      app = await owner();
    await fs.writeFile(path.join(source, 'settings.json'), 'private-invalid-source');
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    await expect(fs.access(path.join(app.data, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await fs.writeFile(path.join(source, 'settings.json'), '{}');
    expect((await app.settings.migrateFromLegacyElectronPath()).errors).toEqual([]);
  });

  it('rejects a destination nested in the selected legacy tree before it can stage itself', async () => {
    const source = await profile();
    const app = await owner(
      'nested',
      path.join(root, 'host-config'),
      path.join(source, 'agent-sessions', 'new-data')
    );
    expect((await app.settings.migrateFromLegacyElectronPath()).errors.length).toBe(1);
    await expect(fs.access(path.join(app.data, '.legacy-electron-import'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(app.data, 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails startup before agent initialization rather than serving defaults after an incomplete import', async () => {
    const source = await profile();
    await fs.writeFile(path.join(source, 'settings.json'), 'private-invalid-profile');
    const initialize = vi.spyOn(AgentService.prototype, 'initialize');
    await expect(
      createNestApplication({
        workingDirectory: root,
        dataDir: path.join(root, 'startup-data'),
        runStartupTasks: true,
        enableShutdownHooks: false,
        providerRegistrations: [],
        environment: {
          NODE_ENV: 'test',
          HOME: path.join(root, 'owned-home'),
          XDG_CONFIG_HOME: path.join(root, 'host-config'),
          AUTOMAKER_API_KEY: 'fixture',
          ENABLE_REQUEST_LOGGING: 'false',
          ALLOWED_ROOT_DIRECTORY: path.join(root, 'startup-data'),
        },
      })
    ).rejects.toThrow('Legacy profile import is incomplete');
    expect(initialize).not.toHaveBeenCalled();
    await expect(fs.access(path.join(root, 'startup-data', 'settings.json'))).rejects.toMatchObject(
      { code: 'ENOENT' }
    );
  });
});
