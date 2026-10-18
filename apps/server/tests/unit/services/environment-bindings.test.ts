import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { ManagedDocker } from '@/services/execution-environment/docker.js';

describe('server-owned environment grants and immutable bindings', () => {
  let temporary: string;
  let project: string;
  let settings: SettingsService;
  let store: EnvironmentBindingStore;
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-binding-test-'));
    project = path.join(temporary, 'project');
    await fs.mkdir(project);
    settings = new SettingsService(path.join(temporary, 'data'));
    store = new EnvironmentBindingStore(
      settings,
      new ManagedDocker(settings, async () => ({
        code: 1,
        stdout: '',
        stderr: 'test daemon unavailable',
      }))
    );
  });
  afterEach(async () => {
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const local = { default: { mode: 'local' as const }, profiles: [] };
  async function bind(key = 'session-a') {
    return store.bind({
      cwd: project,
      projectPath: project,
      key,
      legacySettings: { access: 'read-only' },
    });
  }
  it('keeps unconfigured installs on legacy permissions without a new grant', async () => {
    expect((await bind()).binding.type).toBe('legacy');
    expect((await store.consent()).confirmed).toBe(false);
  });
  it('does not treat saving Local or hiding warnings as confirmation', async () => {
    await settings.updateGlobalSettings({ executionEnvironment: local, skipSandboxWarning: true });
    await expect(bind()).rejects.toThrow('explicit server-side');
  });
  it('explicit confirmation migrates the selected legacy scope without silently upgrading pinned runs', async () => {
    const old = await bind();
    await store.confirm();
    expect((await store.consent()).confirmed).toBe(true);
    expect((await bind()).binding).toEqual(old.binding);
    expect((await bind('session-b')).binding.type).toBe('local');
  });
  it('persists Local binding and confirmation across service restart and setting changes', async () => {
    await store.confirm();
    const first = await bind();
    await settings.updateGlobalSettings({
      executionEnvironment: {
        default: { mode: 'profile', profileId: 'docker' },
        profiles: [{ id: 'docker', name: 'Docker', type: 'docker' }],
      },
    });
    const restarted = new EnvironmentBindingStore(new SettingsService(settings.getDataDirectory()));
    expect(
      (
        await restarted.bind({
          cwd: project,
          projectPath: project,
          key: 'session-a',
          legacySettings: {},
        })
      ).binding
    ).toEqual(first.binding);
    await expect(bind('session-b')).rejects.toThrow('No Local fallback');
  });
  it('supports per-project confirmation without granting other projects access', async () => {
    await store.confirm(project);
    const other = path.join(temporary, 'other');
    await fs.mkdir(other);
    await settings.updateProjectSettings(other, { executionEnvironment: { mode: 'local' } });
    expect((await store.consent(project)).scope).toBe('project');
    expect((await store.consent(other)).confirmed).toBe(false);
    await expect(
      store.bind({ cwd: other, projectPath: other, key: 'other', legacySettings: {} })
    ).rejects.toThrow();
  });
  it('revokes future queries even for pinned Local sessions', async () => {
    await store.confirm();
    await bind();
    await store.revoke();
    await expect(bind()).rejects.toThrow('explicit server-side');
  });
  it('fails closed for Auto, Docker, SSH and deleted profile selections', async () => {
    await store.confirm();
    for (const profile of [
      { id: 'profile', name: 'Docker', type: 'docker' as const },
      {
        id: 'profile',
        name: 'SSH',
        type: 'ssh' as const,
        host: 'example.com',
        port: 22,
        username: 'dev',
        basePath: '/projects',
      },
    ]) {
      await settings.updateGlobalSettings({
        executionEnvironment: {
          default: { mode: 'profile', profileId: 'profile' },
          profiles: [profile],
        },
      });
      await expect(bind(profile.type)).rejects.toThrow('No Local fallback');
    }
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
    });
    await expect(bind('auto')).rejects.toThrow('Auto Local fallback requires');
    await settings.updateProjectSettings(project, {
      executionEnvironment: { mode: 'profile', profileId: 'deleted' },
    });
    await expect(bind('deleted')).rejects.toThrow('missing-profile');
  });
  it('rejects working-copy substitution for an existing run key', async () => {
    await store.confirm();
    await bind();
    const other = path.join(temporary, 'other');
    await fs.mkdir(other);
    await expect(
      store.bind({ cwd: other, projectPath: project, key: 'session-a', legacySettings: {} })
    ).rejects.toThrow('Pinned environment');
  });
  it('does not persist keys or runtime objects in bindings', async () => {
    await store.confirm();
    const result = await bind();
    const file = path.join(
      settings.getDataDirectory(),
      'execution-environments',
      'bindings',
      `${result.binding.id}.json`
    );
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ binding: result.binding });
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });
  it('requires fresh confirmation after server identity changes, then renews a pinned Local binding', async () => {
    await store.confirm();
    const result = await bind();
    const directory = path.join(settings.getDataDirectory(), 'execution-environments');
    const file = path.join(directory, 'bindings', `${result.binding.id}.json`);
    await fs.writeFile(
      file,
      JSON.stringify({ binding: { ...result.binding, serverIdentity: 'old-server' } })
    );
    await store.revoke();
    await expect(bind()).rejects.toThrow('explicit server-side');
    await store.confirm();
    expect((await bind()).binding).toEqual(result.binding);
  });
});
