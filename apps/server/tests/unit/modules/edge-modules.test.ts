import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RUNTIME_CONFIG, type RuntimeConfig } from '../../../src/core/config/index.js';
import { NotFoundDomainError } from '../../../src/core/errors/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../../src/core/security/index.js';
import { ModelsCatalogService } from '../../../src/modules/models/models-catalog.service.js';
import { NotificationsApplicationService } from '../../../src/modules/notifications/notifications.service.js';
import { NotificationService } from '../../../src/services/notification-service.js';
import {
  TEMPLATE_COMMAND_RUNNER,
  type TemplateCommandRunner,
} from '../../../src/modules/templates/template-command.runner.js';
import { TemplatesService } from '../../../src/modules/templates/templates.service.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { SettingsService } from '../../../src/services/settings-service.js';

describe('migrated edge Nest modules', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds the model catalog without launching provider probes', async () => {
    const providers = { allModels: vi.fn().mockReturnValue([]), statuses: vi.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ModelsCatalogService,
        { provide: ProviderRegistry, useValue: providers },
        {
          provide: SettingsService,
          useValue: { getGlobalSettings: vi.fn().mockResolvedValue({}) },
        },
        {
          provide: RUNTIME_CONFIG,
          useValue: { providers: { anthropicApiKeyConfigured: false } } as RuntimeConfig,
        },
      ],
    }).compile();

    await expect(module.get(ModelsCatalogService).listAvailable()).resolves.toEqual({
      success: true,
      models: [],
    });
    expect(providers.statuses).not.toHaveBeenCalled();
    await module.close();
  });

  it('clones a template with argv execution and removes repository metadata', async () => {
    const filesystem = {
      access: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    };
    const commands: TemplateCommandRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stderr: '' }),
    };
    const module = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: SECURE_FILESYSTEM, useValue: filesystem },
        { provide: SecurityService, useValue: { validateLocalPath: (value: string) => value } },
        { provide: TEMPLATE_COMMAND_RUNNER, useValue: commands },
      ],
    }).compile();

    await expect(
      module.get(TemplatesService).clone({
        repoUrl: 'https://github.com/example/template.git',
        projectName: 'sample',
        parentDir: '/workspace',
      })
    ).resolves.toMatchObject({ success: true, projectPath: '/workspace/sample' });
    expect(commands.run).toHaveBeenNthCalledWith(
      1,
      'git',
      ['clone', 'https://github.com/example/template.git', '/workspace/sample'],
      '/workspace'
    );
    expect(filesystem.rm).toHaveBeenCalledWith('/workspace/sample/.git', {
      recursive: true,
      force: true,
    });
    await module.close();
  });

  it('cleans a partial template directory when clone fails', async () => {
    const filesystem = {
      access: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    };
    const module = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: SECURE_FILESYSTEM, useValue: filesystem },
        { provide: SecurityService, useValue: { validateLocalPath: (value: string) => value } },
        {
          provide: TEMPLATE_COMMAND_RUNNER,
          useValue: { run: vi.fn().mockResolvedValue({ exitCode: 128, stderr: 'failed' }) },
        },
      ],
    }).compile();

    await expect(
      module.get(TemplatesService).clone({
        repoUrl: 'https://github.com/example/template.git',
        projectName: 'sample',
        parentDir: '/workspace',
      })
    ).rejects.toThrow('Failed to clone repository');
    expect(filesystem.rm).toHaveBeenCalledWith('/workspace/sample', {
      recursive: true,
      force: true,
    });
    await module.close();
  });

  it('maps missing notification identifiers to the shared not-found domain error', async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationsApplicationService,
        {
          provide: NotificationService,
          useValue: { markAsRead: vi.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    await expect(
      module.get(NotificationsApplicationService).markRead({
        projectPath: '/workspace/project',
        notificationId: 'missing',
      })
    ).rejects.toBeInstanceOf(NotFoundDomainError);
    await module.close();
  });
});
