import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { MCPTestService } from '../../src/services/mcp-test-service.js';
import { nodeOwnedLocalChildRuntime } from '../../src/core/platform/owned-local-child.runtime.js';
const roots: string[] = [],
  apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  const closed = await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function directory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-owned-'));
  roots.push(root);
  return root;
}
const script = path.resolve(import.meta.dirname, '../fixtures/mcp-test-server.mjs');
async function processGone(file: string) {
  const pid = Number(await fs.readFile(file, 'utf8'));
  await vi.waitFor(async () => {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      expect(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]).toMatch(/^[ZXx]$/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  });
}
it.each(['oversize-frame', 'stderr-flood'])(
  'bounds real stdio %s before parsing and confirms process cleanup',
  async (mode) => {
    const root = await directory(),
      pid = path.join(root, 'server.pid');
    const service = new MCPTestService(
      {
        getGlobalSettings: async () => ({
          mcpServers: [
            {
              id: 'saved',
              name: 'Fixture',
              type: 'stdio',
              command: process.execPath,
              args: [script, mode, pid],
            },
          ],
        }),
      } as never,
      1000
    );
    const result = await service.testServerById('saved');
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds the allowed size');
    await processGone(pid);
    await service.beforeApplicationShutdown();
  }
);
it.skipIf(process.platform !== 'linux')(
  'confirms cleanup of an actual TERM-resistant grandchild through captured Linux group identity',
  async () => {
    const root = await directory(),
      pid = path.join(root, 'server.pid');
    const service = new MCPTestService(
      {
        getGlobalSettings: async () => ({
          mcpServers: [
            {
              id: 'saved',
              name: 'Fixture',
              type: 'stdio',
              command: process.execPath,
              args: [script, 'tree', pid],
            },
          ],
        }),
      } as never,
      1000
    );
    expect((await service.testServerById('saved')).success).toBe(true);
    await processGone(pid);
    await processGone(pid + '.child');
    await service.beforeApplicationShutdown();
  }
);
it.skipIf(process.platform !== 'linux')(
  'native stdio preserves each application snapshot after ambient mutation and honors saved server env overrides',
  async () => {
    const entries = [];
    for (const name of ['one', 'two']) {
      const root = await directory(),
        pid = path.join(root, 'server.pid'),
        environment = {
          NODE_ENV: 'test',
          HOME: root,
          PATH: `${root}/tools`,
          ALLOWED_ROOT_DIRECTORY: root,
          AUTOMAKER_API_KEY: `backend-${name}`,
          MCP_OVERRIDE: 'base',
          DATA_DIR: 'backend-data',
          PORT: '0',
          NODE_PATH: 'backend-modules',
        };
      const runtime = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory: root,
        dataDir: path.join(root, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        providerRegistrations: [],
        environment,
      });
      apps.push(runtime);
      await runtime.start();
      await runtime.app.get(SettingsService).updateGlobalSettings({
        mcpServers: [
          {
            id: 'saved',
            name: 'Fixture',
            type: 'stdio',
            command: process.execPath,
            args: [script, 'environment', pid],
            env: { MCP_OVERRIDE: 'saved-override' },
          },
        ],
      });
      entries.push({ root, pid, runtime, environment });
    }
    vi.stubEnv('HOME', '/hostile-home');
    vi.stubEnv('PATH', '/hostile-tools');
    vi.stubEnv('AUTOMAKER_API_KEY', 'hostile-secret');
    for (const entry of entries) {
      entry.environment.HOME = '/mutated-input';
      entry.environment.PATH = '/mutated-tools';
      const result = await entry.runtime.app.get(MCPTestService).listToolsById('saved');
      expect(result.success).toBe(true);
      expect(JSON.parse(result.tools![0].description!)).toEqual({
        HOME: entry.root,
        PATH: `${entry.root}/tools`,
        OVERRIDE: 'saved-override',
      });
      await processGone(entry.pid);
    }
    await entries[0].runtime.app.close();
    expect(
      (await entries[1].runtime.app.get(MCPTestService).testConnectionById('saved')).success
    ).toBe(true);
  }
);
it('bounds accepted settings lookups, drains them before close, and prevents late transport dispatch', async () => {
  let release!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const get = vi.fn(() => held);
  const service = new MCPTestService({ getGlobalSettings: get } as never);
  const accepted = Array.from({ length: 16 }, () => service.testConnectionById('saved'));
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(16));
  expect(await service.testConnectionById('saved')).toMatchObject({
    success: false,
    error: 'MCP discovery admission limit reached',
  });
  let closed = false;
  const close = service.beforeApplicationShutdown().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release({ mcpServers: [{ id: 'saved', command: 'must-never-start' }] });
  expect((await Promise.all(accepted)).every((result) => !result.success)).toBe(true);
  await close;
  expect((await service.testConnectionById('saved')).error).toBe('MCP discovery is shutting down');
});
it('retains unconfirmed settings lookup ownership and caches failed shutdown after late settlement', async () => {
  vi.useFakeTimers();
  let release!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const service = new MCPTestService({ getGlobalSettings: () => held } as never);
  const pending = service.testConnectionById('saved');
  await Promise.resolve();
  const close = service.beforeApplicationShutdown(),
    failed = expect(close).rejects.toThrow('cleanup is unconfirmed');
  await vi.advanceTimersByTimeAsync(5001);
  await failed;
  release({ mcpServers: [{ id: 'saved', command: 'must-never-start' }] });
  expect((await pending).success).toBe(false);
  expect(service.beforeApplicationShutdown()).toBe(close);
  await expect(service.beforeApplicationShutdown()).rejects.toThrow('cleanup is unconfirmed');
});
it.skipIf(process.platform !== 'linux')(
  'retains unknown process cleanup, blocks replacement, and never changes failed close into success',
  async () => {
    const root = await directory(),
      pid = path.join(root, 'server.pid');
    let captures = 0;
    const service = new MCPTestService(
      {
        getGlobalSettings: async () => ({
          mcpServers: [
            {
              id: 'saved',
              name: 'Fixture',
              type: 'stdio',
              command: process.execPath,
              args: [script, 'success', pid],
            },
          ],
        }),
      } as never,
      1000,
      {
        childRuntime: {
          capture(child) {
            captures++;
            const target = nodeOwnedLocalChildRuntime.capture(child);
            return {
              prepare: (signal) => target.prepare(signal),
              signal: (value) => target.signal(value),
              waitForQuiescence: async (signal) => {
                await target.waitForQuiescence(signal);
                throw new Error('Private fixture cannot attest cleanup');
              },
            };
          },
        },
      }
    );
    expect(await service.testServerById('saved')).toMatchObject({
      success: false,
      error: expect.stringContaining('cleanup is unconfirmed'),
    });
    await processGone(pid);
    expect((await service.testServerById('saved')).error).toContain('cleanup is unconfirmed');
    expect(captures).toBe(1);
    const close = service.beforeApplicationShutdown();
    await expect(close).rejects.toThrow('cleanup is unconfirmed');
    expect(service.beforeApplicationShutdown()).toBe(close);
  }
);
