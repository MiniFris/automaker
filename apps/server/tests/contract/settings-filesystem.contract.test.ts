import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { SettingsFileRepository } from '../../src/modules/settings/settings-file.repository.js';
import { DEFAULT_CREDENTIALS } from '../../src/types/settings.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('native settings file ownership', () => {
  let root: string;
  const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const releases: Array<() => void> = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-owned-'));
  });
  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    await Promise.allSettled(applications.splice(0).map(({ app }) => app.close()));
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function owner(name: string) {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(directory, 'data'),
      runStartupTasks: false,
      providerRegistrations: [],
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
        ALLOWED_ROOT_DIRECTORY: directory,
      },
    });
    applications.push(runtime);
    return {
      ...runtime,
      directory,
      settings: runtime.app.get(SettingsService),
      files: runtime.app.get(SettingsFileRepository),
    };
  }

  it('uses independent path policies, private backups and admission after one app closes', async () => {
    const first = await owner('first'),
      second = await owner('second');
    await first.settings.updateCredentials({
      apiKeys: { ...DEFAULT_CREDENTIALS.apiKeys, anthropic: 'fixture-one' },
    });
    await first.settings.updateCredentials({
      apiKeys: { ...DEFAULT_CREDENTIALS.apiKeys, anthropic: 'fixture-two' },
    });
    const target = path.join(first.directory, 'data', 'credentials.json');
    expect(JSON.parse(await fs.readFile(target + '.bak1', 'utf8')).apiKeys.anthropic).toBe(
      'fixture-one'
    );
    if (process.platform !== 'win32') {
      expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(target + '.bak1')).mode & 0o777).toBe(0o600);
    }
    await expect(
      first.files.read(path.join(second.directory, 'settings.json'), {})
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      first.settings.updateProjectSettings(second.directory, { theme: 'light' })
    ).rejects.toMatchObject({ statusCode: 403 });
    await first.app.close();
    await expect(first.settings.updateGlobalSettings({ theme: 'light' })).rejects.toMatchObject({
      statusCode: 503,
    });
    await second.settings.updateGlobalSettings({ theme: 'light' });
    expect((await second.settings.getGlobalSettings()).theme).toBe('light');
  });

  it('serializes project aliases around the entire read-modify-write transaction', async () => {
    const runtime = await owner('aliases');
    const project = path.join(runtime.directory, 'project'),
      alias = path.join(runtime.directory, 'alias');
    await fs.mkdir(project);
    await fs.symlink(project, alias, 'junction');
    const entered = deferred(),
      release = deferred();
    releases.push(release.resolve);
    const read = runtime.files.read.bind(runtime.files);
    let reads = 0;
    vi.spyOn(runtime.files, 'read').mockImplementation(async (...args) => {
      const value = await read(...args);
      if (args[0] === path.join(project, '.automaker', 'settings.json') && ++reads === 1) {
        entered.resolve();
        await release.promise;
      }
      return value;
    });
    const first = runtime.settings.updateProjectSettings(project, { theme: 'light' });
    await entered.promise;
    const second = runtime.settings.updateProjectSettings(alias, { useWorktrees: false });
    await new Promise((resolve) => setImmediate(resolve));
    expect(reads).toBe(1);
    release.resolve();
    await Promise.all([first, second]);
    expect(await runtime.settings.getProjectSettings(project)).toMatchObject({
      theme: 'light',
      useWorktrees: false,
    });
  });

  it('drains accepted transactions before closing the filesystem', async () => {
    const runtime = await owner('drain');
    const entered = deferred(),
      release = deferred();
    releases.push(release.resolve);
    const write = runtime.files.write.bind(runtime.files);
    let writes = 0;
    vi.spyOn(runtime.files, 'write').mockImplementation(async (...args) => {
      if (++writes === 1) {
        entered.resolve();
        await release.promise;
      }
      await write(...args);
    });
    const first = runtime.settings.updateGlobalSettings({ theme: 'light' });
    await entered.promise;
    const second = runtime.settings.updateGlobalSettings({ useWorktrees: false });
    const destroy = vi.spyOn(runtime.settings, 'beforeApplicationShutdown');
    const close = runtime.app.close();
    await vi.waitFor(() => expect(destroy).toHaveBeenCalled());
    await expect(
      runtime.settings.updateGlobalSettings({ sidebarOpen: true })
    ).rejects.toMatchObject({ statusCode: 503 });
    release.resolve();
    await Promise.all([first, second, close]);
    const saved = JSON.parse(
      await fs.readFile(path.join(runtime.directory, 'data', 'settings.json'), 'utf8')
    );
    expect(saved).toMatchObject({ theme: 'light', useWorktrees: false });
  });

  it('does not overwrite a concurrent command with an older migration snapshot', async () => {
    const runtime = await owner('migration');
    const target = path.join(runtime.directory, 'data', 'settings.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ version: 1, theme: 'dark' }));
    const entered = deferred(),
      release = deferred();
    releases.push(release.resolve);
    const read = runtime.files.read.bind(runtime.files);
    let reads = 0;
    vi.spyOn(runtime.files, 'read').mockImplementation(async (...args) => {
      const value = await read(...args);
      if (args[0] === target && ++reads === 1) {
        entered.resolve();
        await release.promise;
      }
      return value;
    });
    const query = runtime.settings.getGlobalSettings();
    await entered.promise;
    await runtime.settings.updateGlobalSettings({ theme: 'light' });
    release.resolve();
    expect((await query).theme).toBe('light');
    expect(JSON.parse(await fs.readFile(target, 'utf8')).theme).toBe('light');
  });
});
