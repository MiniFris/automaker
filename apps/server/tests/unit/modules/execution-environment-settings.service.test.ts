import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExecutionEnvironmentSettingsService } from '@/modules/settings/execution-environment-settings.service.js';
import { SettingsService } from '@/services/settings-service.js';

describe('ExecutionEnvironmentSettingsService', () => {
  let temporary: string;
  let project: string;
  let data: string;
  let service: ExecutionEnvironmentSettingsService;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'nest-environment-settings-'));
    project = path.join(temporary, 'project');
    data = path.join(temporary, 'data');
    await mkdir(project);
    service = new ExecutionEnvironmentSettingsService(new SettingsService(data), {});
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('inspects effective configuration without creating consent state', async () => {
    const result = await service.inspect({ projectPath: project });
    expect(result).toMatchObject({
      success: true,
      projectOverride: null,
      resolved: { type: 'local', runtimeIntegrated: false },
    });
    await expect(readdir(path.join(data, 'execution-environments'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('requires explicit consent before local execution is enabled', async () => {
    await expect(
      service.updateConsent('local', 'confirm', {
        projectPath: project,
        accepted: false,
        warningVersion: 1,
      })
    ).rejects.toThrow('Explicit acceptance');
    const result = await service.updateConsent('local', 'confirm', {
      projectPath: project,
      accepted: true,
      warningVersion: 1,
    });
    expect(result).toMatchObject({
      success: true,
      resolved: { type: 'local', runtimeIntegrated: true },
    });
  });

  it('serializes project selection updates', async () => {
    await service.updateGlobal({
      settings: {
        default: { mode: 'local' },
        profiles: [{ id: 'docker', name: 'Docker', type: 'docker' }],
      },
    });
    const result = await service.updateProject({
      projectPath: project,
      selection: { mode: 'profile', profileId: 'docker' },
    });
    expect(result).toMatchObject({
      success: true,
      projectOverride: { mode: 'profile', profileId: 'docker' },
      resolved: { type: 'docker' },
    });
  });
});
