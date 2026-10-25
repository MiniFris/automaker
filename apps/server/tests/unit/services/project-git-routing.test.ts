import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { ProjectGitService } from '@/services/execution-environment/project-git.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';
import { ManagedDocker } from '@/services/execution-environment/docker.js';
import { AutoModeServiceCompat } from '@/services/auto-mode/index.js';

describe('saved project Git routing without runtime preparation', () => {
  let root: string, settings: SettingsService, service: ProjectGitService;
  const runner = vi.fn();
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-routing-'));
    settings = new SettingsService(path.join(root, 'data'));
    service = new ProjectGitService(settings, new ManagedDocker(settings, runner));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it('preserves legacy routing for unconfigured and explicitly Local projects', async () => {
    expect(await service.resolve(root)).toBeUndefined();
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'local' }, profiles: [] },
    });
    expect(await service.resolve(root)).toBeUndefined();
    expect(runner).not.toHaveBeenCalled();
  });
  it('does not prepare Docker or use consented Auto fallback during Git browsing', async () => {
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'auto' }, profiles: [] },
    });
    await new EnvironmentBindingStore(settings).confirm(root, true);
    await expect(service.resolve(root)).rejects.toMatchObject({ code: 'DOCKER_PROJECT_REQUIRED' });
    expect(runner).not.toHaveBeenCalled();
  });
  it('does not connect or clone an unprepared SSH target', async () => {
    await settings.updateGlobalSettings({
      executionEnvironment: {
        default: { mode: 'profile', profileId: 'ssh' },
        profiles: [
          {
            id: 'ssh',
            name: 'SSH',
            type: 'ssh',
            host: 'invalid.example',
            port: 22,
            username: 'user',
            basePath: '/projects',
          },
        ],
      },
    });
    await expect(service.resolve(root)).rejects.toMatchObject({ code: 'SSH_PROJECT_REQUIRED' });
  });
  it('fails closed for an orphaned project profile', async () => {
    await settings.updateProjectSettings(root, {
      executionEnvironment: { mode: 'profile', profileId: 'missing' },
    });
    await expect(service.resolve(root)).rejects.toMatchObject({
      code: 'GIT_ENVIRONMENT_UNAVAILABLE',
    });
  });
  it.each(['relative/path', 'bad\0path'])(
    'refuses invalid controller aliases before state lookup: %j',
    async (alias) => {
      await expect(service.resolve(alias)).rejects.toMatchObject({ code: 'GIT_PATH_REQUIRED' });
      expect(runner).not.toHaveBeenCalled();
    }
  );
  it('never creates a new binding when an internal reopen id is missing', async () => {
    await expect(
      new EnvironmentBindingStore(settings).bind({
        projectPath: root,
        cwd: root,
        existingId: 'a'.repeat(64),
        legacySettings: {},
      })
    ).rejects.toThrow('disappeared');
  });
  it.skipIf(process.platform !== 'linux')(
    'recognizes active projects addressed through a symlink',
    async () => {
      const real = path.join(root, 'project'),
        alias = path.join(root, 'alias');
      await fs.mkdir(real);
      await fs.symlink(real, alias);
      const compat = Object.create(AutoModeServiceCompat.prototype) as AutoModeServiceCompat;
      Object.assign(compat, {
        globalService: {
          getSharedServices: () => ({
            concurrencyManager: { getAllRunning: () => [{ projectPath: alias }] },
          }),
        },
      });
      expect(await compat.isProjectRunning(real)).toBe(true);
      expect(await compat.isProjectRunning(root)).toBe(false);
    }
  );
});
