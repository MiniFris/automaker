import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.unstubAllEnvs();
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
  it.each([false, true])(
    'keeps container Local consent across hostname changes (project scope: %s)',
    async (projectScoped) => {
      vi.stubEnv('IS_CONTAINERIZED', 'true');
      const hostname = vi.spyOn(os, 'hostname').mockReturnValue('container-before');
      store = new EnvironmentBindingStore(settings);
      const scope = projectScoped ? project : undefined;
      await store.confirm(scope);
      const first = await bind();
      hostname.mockReturnValue('container-after');
      const restarted = new EnvironmentBindingStore(
        new SettingsService(settings.getDataDirectory())
      );
      expect(restarted.serverIdentity).not.toBe(store.serverIdentity);
      expect(await restarted.consent(scope)).toMatchObject({
        confirmed: true,
        scope: projectScoped ? 'project' : 'global',
      });
      const renewed = await restarted.bind({
        cwd: project,
        projectPath: project,
        key: 'session-a',
        legacySettings: {},
      });
      expect(renewed.binding).toEqual({
        ...first.binding,
        serverIdentity: restarted.serverIdentity,
      });
      await restarted.revoke(scope);
      expect((await new EnvironmentBindingStore(settings).consent(scope)).confirmed).toBe(false);
    }
  );
  it('keeps Auto fallback consent across container recreation without granting explicit Local', async () => {
    vi.stubEnv('IS_CONTAINERIZED', 'true');
    const hostname = vi.spyOn(os, 'hostname').mockReturnValue('container-before');
    store = new EnvironmentBindingStore(settings);
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
    });
    await store.confirm(undefined, true);
    hostname.mockReturnValue('container-after');
    expect(await new EnvironmentBindingStore(settings).consent()).toMatchObject({
      confirmed: false,
      autoFallbackConfirmed: true,
      autoFallbackScope: 'global',
    });
  });
  it('does not carry container consent to a different OS user or host execution', async () => {
    vi.stubEnv('IS_CONTAINERIZED', 'true');
    store = new EnvironmentBindingStore(settings);
    await store.confirm();
    const user = os.userInfo();
    const userInfo = vi.spyOn(os, 'userInfo').mockReturnValue({ ...user, uid: user.uid + 1 });
    expect((await new EnvironmentBindingStore(settings).consent()).confirmed).toBe(false);
    userInfo.mockRestore();
    vi.stubEnv('IS_CONTAINERIZED', 'false');
    expect((await store.consent()).confirmed).toBe(true); // Existing owner keeps its captured mode.
    expect((await new EnvironmentBindingStore(settings).consent()).confirmed).toBe(false);
  });
  it('requires new confirmation if the persisted container identity is lost and fails closed if corrupt', async () => {
    vi.stubEnv('IS_CONTAINERIZED', 'true');
    store = new EnvironmentBindingStore(settings);
    await store.confirm();
    const file = path.join(
      settings.getDataDirectory(),
      'execution-environments',
      'container-installation.json'
    );
    if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await fs.unlink(file);
    expect((await store.consent()).confirmed).toBe(false);
    await fs.writeFile(file, JSON.stringify({ version: 1, id: 'invalid' }));
    await expect(store.consent()).rejects.toThrow('installation identity is invalid');
  });
  it('retains host identity checks outside containers', async () => {
    vi.stubEnv('IS_CONTAINERIZED', 'false');
    const hostname = vi.spyOn(os, 'hostname').mockReturnValue('host-before');
    store = new EnvironmentBindingStore(settings);
    await store.confirm();
    hostname.mockReturnValue('host-after');
    expect((await new EnvironmentBindingStore(settings).consent()).confirmed).toBe(false);
  });
  it('accepts old hostname-bound grants only on their original server, never after recreation', async () => {
    vi.stubEnv('IS_CONTAINERIZED', 'true');
    const hostname = vi.spyOn(os, 'hostname').mockReturnValue('container-before');
    store = new EnvironmentBindingStore(settings);
    await store.confirm();
    const directory = path.join(settings.getDataDirectory(), 'execution-environments');
    const file = path.join(
      directory,
      (await fs.readdir(directory)).find((name) => name.startsWith('consent-'))!
    );
    const grant = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...grant, serverIdentity: store.serverIdentity }));
    await fs.unlink(path.join(directory, 'container-installation.json'));
    expect((await new EnvironmentBindingStore(settings).consent()).confirmed).toBe(true);
    hostname.mockReturnValue('container-after');
    const restarted = new EnvironmentBindingStore(settings);
    expect((await restarted.consent()).confirmed).toBe(false);
    await restarted.confirm();
    hostname.mockReturnValue('container-next');
    expect((await new EnvironmentBindingStore(settings).consent()).confirmed).toBe(true);
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
