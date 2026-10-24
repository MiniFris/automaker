import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { MCPTestService } from '../../src/services/mcp-test-service.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { IdeationService } from '../../src/services/ideation-service.js';
import { EventHookService } from '../../src/services/event-hook-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { EventHistoryService } from '../../src/services/event-history-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { MCPApplicationService } from '../../src/modules/mcp/mcp-application.service.js';
import { PipelineApplicationService } from '../../src/modules/pipeline/pipeline-application.service.js';
import { IdeationApplicationService } from '../../src/modules/ideation/ideation-application.service.js';
import { BackgroundIntegrationsLifecycle } from '../../src/modules/orchestration/background-integrations.lifecycle.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import { EVENT_BUS } from '../../src/core/eventing/event-bus.js';

it('owns integration services once per application and preserves native dependency identity, hook lifecycle and project persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-integrations-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root, { recursive: true });
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
    });
    apps.push(runtime);
    return runtime;
  };
  const inspect = (value: unknown) => value as Record<string, unknown>;
  try {
    const first = await start('one'),
      second = await start('two');
    for (const token of [MCPTestService, PipelineService, IdeationService, EventHookService]) {
      expect(first.app.get(token)).not.toBe(second.app.get(token));
      for (const runtime of apps) {
        const wrappers = [...runtime.app.get(ModulesContainer).values()]
          .flatMap((module) => [...module.providers.values()])
          .filter((entry) => entry.token === token);
        expect(wrappers).toHaveLength(1);
        expect(wrappers[0].instance).toBe(runtime.app.get(token));
      }
    }
    for (const runtime of apps) {
      expect(runtime.legacy).not.toHaveProperty('services');
      const mcp = runtime.app.get(MCPTestService),
        pipeline = runtime.app.get(PipelineService),
        ideation = runtime.app.get(IdeationService),
        hooks = runtime.app.get(EventHookService);
      expect(inspect(runtime.app.get(MCPApplicationService)).mcp).toBe(mcp);
      expect(inspect(runtime.app.get(PipelineApplicationService)).pipeline).toBe(pipeline);
      expect(inspect(runtime.app.get(IdeationApplicationService)).ideation).toBe(ideation);
      expect(inspect(runtime.app.get(BackgroundIntegrationsLifecycle)).hooks).toBe(hooks);
      expect(inspect(mcp).settingsService).toBe(runtime.app.get(SettingsService));
      expect(inspect(ideation).settingsService).toBe(runtime.app.get(SettingsService));
      expect(inspect(ideation).featureLoader).toBe(runtime.app.get(FeatureLoader));
      expect(inspect(ideation).providerRegistry).toBe(runtime.app.get(ProviderRegistry));
      expect(inspect(ideation).events).toBe(runtime.app.get(APPLICATION_EVENTS));
      expect(inspect(hooks).events).toBe(runtime.app.get(EVENT_BUS));
      expect(inspect(hooks).eventHistoryService).toBe(runtime.app.get(EventHistoryService));
      expect(inspect(hooks).featureLoader).toBe(runtime.app.get(FeatureLoader));
    }
    const one = path.join(directory, 'one'),
      two = path.join(directory, 'two');
    const step = await first.app.get(PipelineService).addStep(one, {
      name: 'Native fixture',
      order: 0,
      instructions: 'Do not execute',
      colorClass: 'blue',
    });
    expect((await second.app.get(PipelineService).getPipelineConfig(two)).steps).toEqual([]);
    const idea = await first.app.get(IdeationService).createIdea(one, {
      title: 'Native fixture',
      description: 'Owned fixture',
      category: 'technical',
    });
    expect(await second.app.get(IdeationService).getIdeas(two)).toEqual([]);
    await first.app.close();
    expect(inspect(first.app.get(EventHookService)).events).toBeNull();
    expect(inspect(second.app.get(EventHookService)).events).toBe(second.app.get(EVENT_BUS));
    const another = await second.app.get(IdeationService).createIdea(two, {
      title: 'Still live',
      description: 'Owned fixture',
      category: 'technical',
    });
    expect((await second.app.get(IdeationService).getIdeas(two)).map(({ id }) => id)).toEqual([
      another.id,
    ]);
    const restarted = await start('one');
    expect(
      (await restarted.app.get(PipelineService).getPipelineConfig(one)).steps.map(({ id }) => id)
    ).toEqual([step.id]);
    expect((await restarted.app.get(IdeationService).getIdeas(one)).map(({ id }) => id)).toEqual([
      idea.id,
    ]);
  } finally {
    await Promise.all(apps.map(({ app }) => app.close()));
    await rm(directory, { recursive: true, force: true });
  }
});

it('drains an active saved MCP stdio handshake through real Nest shutdown and closes discovery admission', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-mcp-shutdown-'));
  const runtime = await createNestApplication({
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
  });
  const mcp = runtime.app.get(MCPTestService);
  let pending: ReturnType<MCPTestService['testServerById']> | undefined;
  try {
    const pidPath = path.join(directory, 'server.pid');
    await runtime.app.get(SettingsService).updateGlobalSettings({
      mcpServers: [
        {
          id: 'fixture',
          name: 'Owned fixture',
          type: 'stdio',
          command: process.execPath,
          args: [
            path.resolve(import.meta.dirname, '../fixtures/mcp-test-server.mjs'),
            'hang-connect',
            pidPath,
          ],
        },
      ],
    });
    pending = mcp.testServerById('fixture');
    await vi.waitFor(async () => expect(await readFile(pidPath, 'utf8')).toMatch(/^\d+$/));
    const pid = Number(await readFile(pidPath, 'utf8'));
    await runtime.app.close();
    await expect(pending).resolves.toMatchObject({ success: false });
    await vi.waitFor(() => {
      let code: string | undefined;
      try {
        process.kill(pid, 0);
      } catch (error) {
        code = (error as NodeJS.ErrnoException).code;
      }
      expect(code).toBe('ESRCH');
    });
    await expect(mcp.testServerById('fixture')).resolves.toMatchObject({
      success: false,
      error: 'MCP discovery is shutting down',
    });
  } finally {
    await runtime.app.close();
    await pending;
    await rm(directory, { recursive: true, force: true });
  }
});
