import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { AutoModeModule } from '../../src/modules/auto-mode/auto-mode.module.js';
import { AutoModeApplicationService } from '../../src/modules/auto-mode/auto-mode-application.service.js';
import { GitApplicationService } from '../../src/modules/git/git-application.service.js';
import { WorktreeApplicationService } from '../../src/modules/worktree/worktree-application.service.js';
import { RunningAgentsService } from '../../src/modules/agents/running-agents.service.js';
import { FeatureQueryService } from '../../src/modules/features/feature-query.service.js';
import { ProjectOverviewService } from '../../src/modules/projects/project-overview.service.js';
import { ApplicationRuntimeLifecycle } from '../../src/core/lifecycle/application-runtime.lifecycle.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import {
  FEATURE_RUN_READ_MODEL,
  FEATURE_ORPHAN_QUERY,
  AUTO_MODE_LIFECYCLE,
  AUTO_MODE_SCHEDULER,
  FEATURE_WORKFLOW,
  type FeatureRunReadModel,
} from '../../src/modules/auto-mode/auto-mode.ports.js';

const publicTokens = [FEATURE_RUN_READ_MODEL, FEATURE_ORPHAN_QUERY, AUTO_MODE_LIFECYCLE];
const tokens = [...publicTokens, AUTO_MODE_SCHEDULER, FEATURE_WORKFLOW];
const inspect = (object: unknown) => object as Record<string, unknown>;

it.each([false, true])(
  'aliases one isolated owner and caches shutdown (cleanup failure: %s)',
  async (fail) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-auto-ports-'));
    const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    try {
      for (const name of ['one', 'two']) {
        const root = path.join(directory, name);
        await mkdir(root);
        const runtime = await createNestApplication({
          workingDirectory: root,
          dataDir: path.join(root, 'data'),
          host: '127.0.0.1',
          port: 0,
          runStartupTasks: false,
          enableShutdownHooks: false,
          providerRegistrations: [],
          environment: {
            NODE_ENV: 'test',
            AUTOMAKER_API_KEY: 'fixture',
            ALLOWED_ROOT_DIRECTORY: root,
            ENABLE_REQUEST_LOGGING: 'false',
          },
        });
        apps.push(runtime);
        await runtime.start();
        const owner = runtime.app.get(AutoModeServiceCompat);
        const module = [...runtime.app.get(ModulesContainer).values()].find(
          (entry) => entry.metatype === AutoModeModule
        )!;
        expect([...module.exports]).toEqual(publicTokens);
        expect(module.providers.get(AutoModeServiceCompat)?.isAlias).toBe(false);
        for (const token of tokens) {
          expect(runtime.app.get(token)).toBe(owner);
          expect(module.providers.get(token)?.instance).toBe(owner);
          expect(module.providers.get(token)?.isAlias).toBe(true);
        }
        for (const consumer of [
          GitApplicationService,
          WorktreeApplicationService,
          RunningAgentsService,
          FeatureQueryService,
          ProjectOverviewService,
          ApplicationRuntimeLifecycle,
        ]) {
          expect(inspect(runtime.app.get(consumer)).autoMode).toBe(owner);
        }
        for (const field of ['scheduler', 'workflows', 'recovery']) {
          expect(inspect(runtime.app.get(AutoModeApplicationService))[field]).toBe(owner);
        }
      }
      const [first, second] = apps;
      const owner = first.app.get(AutoModeServiceCompat);
      expect(owner).not.toBe(second.app.get(AutoModeServiceCompat));
      const project = path.join(directory, 'one');
      await first.app
        .get(FeatureLoader)
        .create(project, { id: 'leased', title: 'Owned lease', status: 'backlog' });
      const manager = owner.getGlobalService().getSharedServices().concurrencyManager;
      await manager.acquireAsync({ projectPath: project, featureId: 'leased', isAutoMode: false });
      const reads = first.app.get<FeatureRunReadModel>(FEATURE_RUN_READ_MODEL);
      expect(await reads.isProjectRunning(project)).toBe(true);
      expect(await reads.getRunningAgents()).toEqual([
        expect.objectContaining({ featureId: 'leased' }),
      ]);
      expect(
        await second.app.get<FeatureRunReadModel>(FEATURE_RUN_READ_MODEL).getRunningAgents()
      ).toEqual([]);
      const address = first.app.getHttpServer().address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/running-agents`, {
        headers: { 'x-api-key': 'fixture' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        runningAgents: [expect.objectContaining({ featureId: 'leased' })],
      });
      manager.release('leased');
      const order: string[] = [];
      const global = owner.getGlobalService();
      const original = global.onModuleDestroy.bind(global);
      const globalDestroy = vi.spyOn(global, 'onModuleDestroy').mockImplementation(async () => {
        order.push('owner');
        await original();
        if (fail) throw new Error('private fixture cleanup failure');
      });
      const ownerHook = vi.spyOn(owner, 'onModuleDestroy');
      const siblingHook = vi.spyOn(second.app.get(AutoModeServiceCompat), 'onModuleDestroy');
      const fs = first.app.get(SECURE_FILESYSTEM);
      const destroyFs = fs.beforeApplicationShutdown.bind(fs);
      vi.spyOn(fs, 'beforeApplicationShutdown').mockImplementation(async () => {
        order.push('filesystem');
        await destroyFs();
      });
      const closing = first.app.close().then(
        () => undefined,
        (error) => error
      );
      const repeated = first.app.close().then(
        () => undefined,
        (error) => error
      );
      if (fail) {
        const failure = await closing;
        expect(await repeated).toBe(failure);
        expect(failure).toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
        expect(await first.app.close().catch((error) => error)).toBe(failure);
      } else {
        expect(await closing).toBeUndefined();
        expect(await repeated).toBeUndefined();
      }
      expect(ownerHook).toHaveBeenCalledOnce();
      expect(globalDestroy).toHaveBeenCalledOnce();
      expect(siblingHook).not.toHaveBeenCalled();
      expect(order).toEqual(['owner', 'filesystem']);
      expect(
        await second.app.get<FeatureRunReadModel>(FEATURE_RUN_READ_MODEL).getRunningAgents()
      ).toEqual([]);
    } finally {
      await Promise.allSettled(apps.map((runtime) => runtime.app.close()));
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
