import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ModulesContainer } from '@nestjs/core';
import { CodexUsageRuntime } from '../../src/core/platform/codex-usage.runtime.js';
import { createNestApplication } from '../../src/main.js';
import { ClaudeUsageService } from '../../src/services/claude-usage-service.js';
import { CodexAppServerService } from '../../src/services/codex-app-server-service.js';
import { CodexModelCacheService } from '../../src/services/codex-model-cache-service.js';
import { CodexUsageService } from '../../src/services/codex-usage-service.js';
import { GeminiUsageService } from '../../src/services/gemini-usage-service.js';
import { ZaiUsageService } from '../../src/services/zai-usage-service.js';
import { ProviderUsageService } from '../../src/modules/providers/provider-usage.service.js';
import {
  CodexModelWarmup,
  PROVIDER_STARTUP_TASKS,
} from '../../src/modules/providers/codex-model-warmup.service.js';

vi.mock('@automaker/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@automaker/platform')>()),
  findCodexCliPath: vi.fn(async () => '/offline-fixture/codex'),
}));

it('owns usage instances, shared Codex dependency and disk caches outside the legacy bridge', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-usage-owner-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const dataDir = path.join(directory, name);
    await mkdir(dataDir, { recursive: true });
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workingDirectory: directory,
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'offline-fixture',
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    apps.push(runtime);
    return { runtime, dataDir };
  };
  try {
    const first = await start('one');
    const second = await start('two');
    for (const fixture of [first, second]) {
      vi.spyOn(fixture.runtime.app.get(CodexUsageRuntime), 'snapshot').mockResolvedValue({
        environment: {},
        workingDirectory: fixture.dataDir,
        cliPath: '/offline-fixture/codex',
        authFilePath: '/offline-fixture/auth.json',
      });
    }
    const tokens = [
      ClaudeUsageService,
      CodexAppServerService,
      CodexModelCacheService,
      CodexUsageService,
      GeminiUsageService,
      ZaiUsageService,
    ];
    for (const token of tokens) {
      expect(first.runtime.app.get(token)).not.toBe(second.runtime.app.get(token));
      for (const fixture of [first, second]) {
        const instances = [...fixture.runtime.app.get(ModulesContainer).values()]
          .flatMap((module) => [...module.providers.values()])
          .filter((provider) => provider.token === token);
        expect(instances, token.name).toHaveLength(1);
        expect(instances[0].instance).toBe(fixture.runtime.app.get(token));
      }
    }
    expect(first.runtime).not.toHaveProperty('legacy');
    const firstAppServer = first.runtime.app.get(CodexAppServerService);
    const secondAppServer = second.runtime.app.get(CodexAppServerService);
    const firstAvailable = vi.spyOn(firstAppServer, 'isAvailable').mockResolvedValue(true);
    const secondAvailable = vi.spyOn(secondAppServer, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(firstAppServer, 'getModels').mockResolvedValue({
      data: [
        {
          id: 'first-fixture',
          displayName: 'First fixture',
          description: 'Offline',
          supportedReasoningEfforts: [],
          isDefault: true,
        },
      ],
    } as never);
    vi.spyOn(secondAppServer, 'getModels').mockResolvedValue({
      data: [
        {
          id: 'second-fixture',
          displayName: 'Second fixture',
          description: 'Offline',
          supportedReasoningEfforts: [],
          isDefault: true,
        },
      ],
    } as never);
    vi.spyOn(firstAppServer, 'getRateLimits').mockResolvedValue(null);
    const account = vi.spyOn(firstAppServer, 'getAccount').mockResolvedValue({
      account: { type: 'chatgpt', planType: 'plus' },
      requiresOpenaiAuth: true,
    });
    // Exercise CodexUsageService's actual injected dependency, not a duplicate client.
    expect(await first.runtime.app.get(ProviderUsageService).codexUsage()).toMatchObject({
      status: 200,
      body: { rateLimits: { planType: 'plus' } },
    });
    expect(account).toHaveBeenCalledOnce();
    for (const [fixture, id] of [
      [first, 'first-fixture'],
      [second, 'second-fixture'],
    ] as const) {
      expect(
        await fixture.runtime.app.get(ProviderUsageService).codexModelCatalog(true)
      ).toMatchObject({
        status: 200,
        body: { success: true, models: [{ id: `codex-${id}` }] },
      });
      const disk = JSON.parse(
        await readFile(path.join(fixture.dataDir, 'codex-models-cache.json'), 'utf8')
      );
      expect(disk.models.map((model: { id: string }) => model.id)).toEqual([`codex-${id}`]);
    }
    expect(firstAvailable).toHaveBeenCalledOnce();
    expect(secondAvailable).toHaveBeenCalledOnce();
    const secondZai = second.runtime.app.get(ZaiUsageService);
    const secondToken = secondZai.getApiToken();
    first.runtime.app.get(ZaiUsageService).setApiToken('instance-one-offline-fixture');
    expect(secondZai.getApiToken()).toBe(secondToken);
    await first.runtime.app.close();
    await expect(first.runtime.app.get(CodexModelCacheService).refreshModels()).rejects.toThrow(
      'shutting down'
    );
    expect(
      await second.runtime.app.get(ProviderUsageService).codexModelCatalog(false)
    ).toMatchObject({
      status: 200,
      body: { models: [{ id: 'codex-second-fixture' }] },
    });
    await second.runtime.app.close();
    const restarted = await start('two');
    const noProbe = vi.spyOn(restarted.runtime.app.get(CodexAppServerService), 'isAvailable');
    expect(
      await restarted.runtime.app.get(ProviderUsageService).codexModelCatalog(false)
    ).toMatchObject({
      status: 200,
      body: { models: [{ id: 'codex-second-fixture' }] },
    });
    expect(noProbe).not.toHaveBeenCalled();
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});

it('waits for a real cache warmup and its disk write before completing Nest shutdown', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-model-warmup-'));
  let finish!: (value: { data: never[]; nextCursor: null }) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<{ data: never[]; nextCursor: null }>((resolve) => {
    finish = resolve;
  });
  const appServer = {
    isAvailable: vi.fn(async () => true),
    getModels: vi.fn(() => {
      started();
      return pending;
    }),
  };
  const module = await Test.createTestingModule({
    providers: [
      CodexModelWarmup,
      { provide: PROVIDER_STARTUP_TASKS, useValue: true },
      {
        provide: CodexModelCacheService,
        useFactory: () => new CodexModelCacheService(directory, appServer as never),
      },
    ],
  }).compile();
  try {
    await module.init();
    await entered;
    const cacheShutdown = vi.spyOn(module.get(CodexModelCacheService), 'onApplicationShutdown');
    const cacheDrain = vi.spyOn(module.get(CodexModelCacheService), 'beforeApplicationShutdown');
    const warmupShutdown = vi.spyOn(module.get(CodexModelWarmup), 'onApplicationShutdown');
    let stopped = false;
    const closing = module.close().then(() => {
      stopped = true;
    });
    await vi.waitFor(() => {
      expect(cacheDrain).toHaveBeenCalledOnce();
    });
    expect(stopped).toBe(false);
    finish({ data: [], nextCursor: null });
    await closing;
    expect(stopped).toBe(true);
    expect(warmupShutdown).toHaveBeenCalledOnce();
    expect(cacheShutdown).toHaveBeenCalledOnce();
    expect(
      JSON.parse(await readFile(path.join(directory, 'codex-models-cache.json'), 'utf8'))
    ).toMatchObject({ models: [] });
    expect(appServer.getModels).toHaveBeenCalledOnce();
    await expect(module.get(CodexModelCacheService).getModels()).rejects.toThrow('shutting down');
  } finally {
    finish({ data: [], nextCursor: null });
    await module.close();
    await rm(directory, { recursive: true, force: true });
  }
});
