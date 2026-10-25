import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerService } from '../../../src/services/codex-app-server-service.js';
import { CodexUsageRuntime } from '../../../src/core/platform/codex-usage.runtime.js';
import * as groups from '../../../src/core/platform/linux-process-group.js';
import { CodexAppServerCleanupError } from '../../../src/services/codex-app-server-service.js';
import { CodexUsageService } from '../../../src/services/codex-usage-service.js';
import { CodexModelCacheService } from '../../../src/services/codex-model-cache-service.js';

const owned: { directory: string; service: CodexAppServerService; failed?: boolean }[] = [];
afterEach(async () => {
  for (const item of owned.splice(0)) {
    if (item.failed)
      await expect(item.service.onApplicationShutdown()).rejects.toThrow(
        'cleanup could not be confirmed'
      );
    else await item.service.onApplicationShutdown();
    await rm(item.directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});
async function fixture(mode = 'success', requestMs = 3000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-owned-'));
  await copyFile(
    new URL('../../fixtures/codex-usage/app-server.cjs', import.meta.url),
    path.join(directory, 'app-server')
  );
  let generation = 0;
  const runtime: CodexUsageRuntime = {
    snapshot: vi.fn(async () => ({
      cliPath: process.execPath,
      workingDirectory: directory,
      authFilePath: path.join(directory, 'unused-auth'),
      environment: {
        FIXTURE_MODE: mode,
        FIXTURE_CAPTURE: path.join(directory, `capture-${++generation}.json`),
        HOME: directory,
        OPENAI_API_KEY: 'offline-owned-key',
      },
    })),
    readAuth: vi.fn(),
  };
  const service = new CodexAppServerService(runtime, { requestMs, killMs: 50, cleanupMs: 1500 });
  owned.push({ directory, service });
  const read = async () =>
    JSON.parse(await readFile(path.join(directory, `capture-${generation}.json`), 'utf8'));
  return { directory, service, runtime, read };
}

describe('owned offline Codex app-server RPC', () => {
  it('does not hide uncertain process cleanup behind auth-file or model-cache fallback', async () => {
    const failure = new CodexAppServerCleanupError();
    const appServer = {
      isAvailable: vi.fn(async () => true),
      getAccount: vi.fn(async () => {
        throw failure;
      }),
      getRateLimits: vi.fn(async () => null),
      getModels: vi.fn(async () => {
        throw failure;
      }),
    };
    const runtime = {
      snapshot: vi.fn(async () => ({ cliPath: '/offline-fixture' })),
      readAuth: vi.fn(),
    };
    const usage = new CodexUsageService(appServer as never, runtime as never);
    await expect(usage.fetchUsageData()).rejects.toBe(failure);
    expect(runtime.readAuth).not.toHaveBeenCalled();
    const cache = new CodexModelCacheService('/unused-no-io', appServer as never);
    await expect(cache.refreshModels()).rejects.toBe(failure);
    await cache.onApplicationShutdown();
  });
  it.skipIf(process.platform !== 'linux').each(['observer failure', 'observer timeout'])(
    'does not acknowledge success or admit a replacement after %s',
    async (mode) => {
      const f = await fixture();
      owned[owned.length - 1].failed = true;
      const observer = vi.spyOn(groups, 'waitForLinuxProcessGroupExit');
      if (mode === 'observer failure')
        observer.mockRejectedValueOnce(new Error('private-procfs-detail'));
      else
        observer.mockImplementationOnce(
          (_, signal) =>
            new Promise((_, reject) =>
              signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
            )
        );
      await expect(f.service.getModels()).rejects.toThrow(
        'Codex app-server cleanup could not be confirmed.'
      );
      await expect(f.service.getAccount()).rejects.toThrow('unavailable');
      const record = await f.read();
      expect(() => process.kill(record.pid, 0)).toThrow();
    }
  );
  it('completes only after slow process close and uses the documented read-only handshake', async () => {
    const f = await fixture('slow-close');
    const response = await f.service.getModels();
    expect(response?.data[0].displayName).toBe('Модель');
    const record = await f.read();
    expect(record.methods.map((value: { method: string }) => value.method)).toEqual([
      'initialize',
      'initialized',
      'model/list',
    ]);
    expect(() => process.kill(record.pid, 0)).toThrow();
  });
  it('handles a UTF-8 response split across chunks', async () => {
    const f = await fixture('utf8');
    expect((await f.service.getModels())?.data[0].displayName).toBe('Модель');
  });
  it.each(['malformed', 'oversized', 'approval', 'early-exit'])(
    'fails %s protocol safely and confirms child close',
    async (mode) => {
      const f = await fixture(mode);
      expect(await f.service.getAccount()).toBeNull();
      const record = await f.read();
      expect(() => process.kill(record.pid, 0)).toThrow();
    }
  );
  it('times out an unresponsive child, escalates termination and drains it', async () => {
    const f = await fixture('hang', 500);
    expect(await f.service.getAccount()).toBeNull();
    const record = await f.read();
    expect(() => process.kill(record.pid, 0)).toThrow();
  });
  it('shuts down active queries before dependency shutdown and closes admission', async () => {
    const f = await fixture('ignore-term');
    const result = f.service.getModels();
    await vi.waitFor(async () => expect((await f.read()).methods.length).toBeGreaterThan(0));
    const closing = f.service.beforeApplicationShutdown();
    expect(f.service.onApplicationShutdown()).toBe(closing);
    await expect(f.service.getModels()).rejects.toThrow('unavailable');
    await closing;
    await result;
    const record = await f.read();
    expect(() => process.kill(record.pid, 0)).toThrow();
  });
  it('cancels deferred discovery at shutdown without ever launching the resolved CLI', async () => {
    const snapshot = vi.fn(() => new Promise<never>(() => {}));
    const service = new CodexAppServerService({ snapshot, readAuth: vi.fn() });
    const tasks = [
      service.getModels(),
      service.getAccount(),
      service.getRateLimits(),
      service.getModels(),
    ];
    await expect(service.getModels()).rejects.toThrow('busy');
    expect(snapshot).toHaveBeenCalledTimes(4);
    await service.onApplicationShutdown();
    expect(await Promise.all(tasks)).toEqual([null, null, null, null]);
  });
  it.skipIf(process.platform !== 'linux')(
    'confirms quiescence of an ordinary same-group descendant after its parent exits',
    async () => {
      const f = await fixture('descendant');
      expect(await f.service.getAccount()).not.toBeNull();
      const record = await f.read();
      expect(record.descendant).toBeGreaterThan(1);
      try {
        const stat = await readFile(`/proc/${record.descendant}/stat`, 'utf8');
        const state = stat
          .slice(stat.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/)[0];
        expect(['Z', 'X', 'x'].includes(state)).toBe(true);
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
    }
  );
  it('treats spawn failure as unavailable without an unhandled error or wait leak', async () => {
    const f = await fixture();
    vi.mocked(f.runtime.snapshot).mockResolvedValue({
      cliPath: '/missing-offline-codex',
      workingDirectory: f.directory,
      authFilePath: '/unused',
      environment: {},
    });
    expect(await f.service.getModels()).toBeNull();
  });
});
