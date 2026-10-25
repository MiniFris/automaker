import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { EventHookService } from '../../src/services/event-hook-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { LocalExecutionEnvironment } from '../../src/services/execution-environment/local.js';
import { ExecutionEnvironmentError } from '../../src/services/execution-environment/runtime.js';
import { parseLinuxProcessStat } from '../../src/core/platform/linux-process-group.js';

const start = (directory: string) =>
  createNestApplication({
    workingDirectory: directory,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
  });

it('native shutdown aborts and drains active HTTP/ntfy hooks without stopping another application owner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-hook-http-drain-'));
  const requests = new Map<string, ServerResponse>();
  const server = createServer((request, response) => {
    request.resume();
    requests.set(request.url!, response);
    // Do not send headers: both native fetches remain active until their owner aborts.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const apps: Awaited<ReturnType<typeof start>>[] = [];
  try {
    for (const name of ['one', 'two']) {
      const app = await start(path.join(directory, name));
      apps.push(app);
      await app.app.get(SettingsService).updateGlobalSettings({
        eventHooks: [
          {
            id: 'http',
            name: 'Owned HTTP',
            enabled: true,
            trigger: 'feature_created',
            action: { type: 'http', url: `http://127.0.0.1:${port}/http/${name}` },
          },
          {
            id: 'ntfy',
            name: 'Owned ntfy',
            enabled: true,
            trigger: 'feature_created',
            action: { type: 'ntfy', endpointId: 'endpoint' },
          },
        ],
        ntfyEndpoints: [
          {
            id: 'endpoint',
            name: 'Owned fixture',
            enabled: true,
            serverUrl: `http://127.0.0.1:${port}/ntfy/${name}`,
            topic: 'owned',
            authType: 'none',
          },
        ],
      });
      app.app
        .get<EventBus>(EVENT_BUS)
        .emit('feature:created', { featureId: name, projectPath: path.join(directory, name) });
    }
    await vi.waitFor(() => expect(requests.size).toBe(4));
    await apps[0].app.close();
    await vi.waitFor(() => {
      expect(requests.get('/http/one')!.destroyed).toBe(true);
      expect(requests.get('/ntfy/one/owned')!.destroyed).toBe(true);
    });
    expect(requests.get('/http/two')!.destroyed).toBe(false);
    expect(requests.get('/ntfy/two/owned')!.destroyed).toBe(false);
    apps[0].app
      .get<EventBus>(EVENT_BUS)
      .emit('feature:created', { featureId: 'late', projectPath: directory });
    expect(
      (apps[0].app.get(EventHookService) as unknown as { pending: Set<unknown> }).pending.size
    ).toBe(0);
    expect(requests.size).toBe(4);
    await apps[1].app.close();
    await vi.waitFor(() =>
      expect([...requests.values()].every((response) => response.destroyed)).toBe(true)
    );
  } finally {
    try {
      await Promise.all(apps.map((runtime) => runtime.app.close()));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }
});

it.skipIf(process.platform !== 'linux')(
  'native shutdown drains a real shell hook and its TERM-resistant child through the shared process supervisor',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-hook-process-drain-'));
    const runtime = await start(directory);
    let group: number | undefined;
    try {
      const file = path.join(directory, 'pids.json');
      const fixture = path.resolve(import.meta.dirname, '../fixtures/terminal-drain.mjs');
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      await runtime.app.get(SettingsService).updateGlobalSettings({
        eventHooks: [
          {
            id: 'shell',
            name: 'Owned process',
            enabled: true,
            trigger: 'auto_mode_complete',
            action: {
              type: 'shell',
              command: `exec ${quote(process.execPath)} ${quote(fixture)} ${quote(file)}`,
            },
          },
        ],
      });
      runtime.app.get<EventBus>(EVENT_BUS).emit('auto-mode:event', { type: 'auto_mode_idle' });
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(file, 'utf8')).root).toBeGreaterThan(1)
      );
      const pids = JSON.parse(await readFile(file, 'utf8')) as { root: number; child: number };
      expect(parseLinuxProcessStat(await readFile(`/proc/${pids.root}/stat`, 'utf8')).group).toBe(
        pids.root
      );
      group = pids.root;
      await runtime.app.close();
      for (const pid of [pids.root, pids.child]) {
        try {
          expect(['Z', 'X', 'x']).toContain(
            parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state
          );
        } catch (error) {
          expect(error).toMatchObject({ code: 'ENOENT' });
        }
      }
    } finally {
      if (group) {
        try {
          process.kill(-group, 'SIGKILL');
        } catch {
          /* only this fixture's verified group */
        }
      }
      try {
        await runtime.app.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
);

it('native close reports uncertain hook cleanup and still attempts later provider owners', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-hook-failed-drain-'));
  const runtime = await start(directory);
  const execute = vi
    .spyOn(LocalExecutionEnvironment.prototype, 'exec')
    .mockRejectedValue(
      new ExecutionEnvironmentError('PROCESS_CLEANUP_FAILED', 'private-hook-cleanup')
    );
  const providers = vi.spyOn(runtime.app.get(ProviderRegistry), 'onApplicationShutdown');
  try {
    await runtime.app.get(SettingsService).updateGlobalSettings({
      eventHooks: [
        {
          id: 'shell',
          enabled: true,
          trigger: 'auto_mode_complete',
          action: { type: 'shell', command: 'not-executed-fixture' },
        },
      ],
    });
    runtime.app.get<EventBus>(EVENT_BUS).emit('auto-mode:event', { type: 'auto_mode_idle' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(
        (runtime.app.get(EventHookService) as unknown as { pending: Set<unknown> }).pending.size
      ).toBe(0)
    );
    await expect(runtime.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
    await expect(runtime.app.close()).rejects.not.toThrow('private-hook-cleanup');
    expect(providers).toHaveBeenCalledOnce();
  } finally {
    execute.mockRestore();
    providers.mockRestore();
    await runtime.app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
