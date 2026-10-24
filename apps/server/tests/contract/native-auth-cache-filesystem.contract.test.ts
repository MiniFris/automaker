import { mkdtemp, mkdir, rm, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AuthStateRepository } from '../../src/core/auth/auth-state.repository.js';
import {
  CodexModelCacheService,
  CodexModelCacheStorageError,
} from '../../src/services/codex-model-cache-service.js';
import { CodexAppServerService } from '../../src/services/codex-app-server-service.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import { parseRuntimeConfig } from '../../src/core/config/index.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-auth-cache-fs-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string) {
  const directory = path.join(root, name),
    data = path.join(directory, 'data');
  await mkdir(directory, { recursive: true });
  const owner = await createNestApplication({
    workingDirectory: directory,
    dataDir: data,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: directory, AUTOMAKER_API_KEY: '' },
  });
  apps.push(owner);
  const server = owner.app.get(CodexAppServerService);
  vi.spyOn(server, 'isAvailable').mockResolvedValue(true);
  const models = vi.spyOn(server, 'getModels').mockResolvedValue({
    data: [
      {
        id: name,
        model: name,
        displayName: name,
        description: 'Owned fixture model',
        supportedReasoningEfforts: [],
        defaultReasoningEffort: 'medium',
        isDefault: true,
      },
    ],
    nextCursor: null,
  });
  return {
    ...owner,
    data,
    directory,
    auth: owner.app.get(AuthStateRepository),
    cache: owner.app.get(CodexModelCacheService),
    filesystem: owner.app.get(SECURE_FILESYSTEM),
    server,
    models,
  };
}

it('keeps auth keys/sessions and model cache application-owned and private', async () => {
  const one = await start('one'),
    two = await start('two');
  for (const owner of [one, two]) {
    expect((owner.auth as unknown as { filesystem: unknown }).filesystem).toBe(owner.filesystem);
    expect((owner.cache as unknown as { filesystem: unknown }).filesystem).toBe(owner.filesystem);
  }
  const key = (await readFile(path.join(one.data, '.api-key'), 'utf8')).trim();
  expect(one.auth.validateApiKey(key)).toBe(true);
  expect(two.auth.validateApiKey(key)).toBe(false);
  const session = await one.auth.createSession();
  expect(two.auth.validateSession(session)).toBe(false);
  expect(await one.cache.getModels()).toMatchObject([{ id: 'codex-one' }]);
  expect(await one.cache.getModels()).toMatchObject([{ id: 'codex-one' }]);
  expect(one.models).toHaveBeenCalledOnce();
  await writeFile(path.join(one.data, 'codex-models-cache.json'), 'null');
  expect(await one.cache.getModels()).toMatchObject([{ id: 'codex-one' }]);
  expect(one.models).toHaveBeenCalledTimes(2);
  expect(await two.cache.getModels()).toMatchObject([{ id: 'codex-two' }]);
  if (process.platform !== 'win32')
    for (const file of ['.api-key', '.sessions', 'codex-models-cache.json'])
      expect((await stat(path.join(one.data, file))).mode & 0o777).toBe(0o600);
  await one.app.close();
  expect(one.auth.validateSession(session)).toBe(false);
  await two.auth.createSession();
  expect(await two.cache.getModels()).toMatchObject([{ id: 'codex-two' }]);
});

it('rejects denied data roots and EIO without replacing auth sessions or pretending a successful refresh', async () => {
  const one = await start('denied-one'),
    two = await start('denied-two');
  const foreignAuth = new AuthStateRepository(
    parseRuntimeConfig({ DATA_DIR: two.data, AUTOMAKER_API_KEY: 'fixture' }),
    one.filesystem
  );
  await expect(foreignAuth.onModuleInit()).rejects.toThrow();
  const foreignCache = new CodexModelCacheService(two.data, one.server, 3600000, one.filesystem);
  await expect(foreignCache.getModels()).rejects.toBeInstanceOf(CodexModelCacheStorageError);
  await expect(foreignCache.refreshModels()).rejects.toBeInstanceOf(CodexModelCacheStorageError);
  const token = await one.auth.createSession();
  const sessions = path.join(one.data, '.sessions'),
    before = await readFile(sessions, 'utf8');
  const rename = one.filesystem.rename.bind(one.filesystem);
  const fault = vi
    .spyOn(one.filesystem, 'rename')
    .mockImplementation((from, to) =>
      to === sessions
        ? Promise.reject(Object.assign(new Error('Owned auth write fixture'), { code: 'EIO' }))
        : rename(from, to)
    );
  await expect(one.auth.createSession()).rejects.toMatchObject({ code: 'EIO' });
  expect(one.auth.validateSession(token)).toBe(true);
  expect(await readFile(sessions, 'utf8')).toBe(before);
  fault.mockRestore();
  const read = one.filesystem.readFile.bind(one.filesystem),
    cache = path.join(one.data, 'codex-models-cache.json');
  const io = vi
    .spyOn(one.filesystem, 'readFile')
    .mockImplementation((candidate, ...args) =>
      candidate === cache
        ? Promise.reject(Object.assign(new Error('Owned cache read fixture'), { code: 'EIO' }))
        : read(candidate, ...args)
    );
  await expect(one.cache.getModels()).rejects.toMatchObject({ operation: 'read', statusCode: 503 });
  io.mockRestore();
  const failing = vi
    .spyOn(one.filesystem, 'rename')
    .mockImplementation((from, to) =>
      to === cache
        ? Promise.reject(Object.assign(new Error('Owned cache write fixture'), { code: 'EIO' }))
        : rename(from, to)
    );
  await expect(one.cache.refreshModels()).rejects.toMatchObject({
    operation: 'write',
    statusCode: 503,
  });
  failing.mockRestore();
  expect(await one.cache.refreshModels()).toMatchObject([{ id: 'codex-denied-one' }]);
});

it('drains accepted auth and cache commits before the shared filesystem closes', async () => {
  const owner = await start('shutdown');
  const sessions = path.join(owner.data, '.sessions'),
    cache = path.join(owner.data, 'codex-models-cache.json');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rename = owner.filesystem.rename.bind(owner.filesystem);
  const commits = new Set<string>();
  vi.spyOn(owner.filesystem, 'rename').mockImplementation(async (from, to) => {
    if (to === sessions || to === cache) {
      commits.add(to);
      await held;
    }
    return rename(from, to);
  });
  const session = owner.auth.createSession(),
    refresh = owner.cache.refreshModels();
  await vi.waitFor(() => expect(commits.size).toBe(2));
  const authDrain = owner.auth.beforeApplicationShutdown.bind(owner.auth),
    cacheDrain = owner.cache.beforeApplicationShutdown.bind(owner.cache);
  const order: string[] = [];
  vi.spyOn(owner.auth, 'beforeApplicationShutdown').mockImplementation(async () => {
    await authDrain();
    order.push('auth-drained');
  });
  vi.spyOn(owner.cache, 'beforeApplicationShutdown').mockImplementation(async () => {
    await cacheDrain();
    order.push('cache-drained');
  });
  const close = owner.filesystem.close.bind(owner.filesystem);
  const closed = vi.spyOn(owner.filesystem, 'close').mockImplementation(async () => {
    expect(order).toContain('auth-drained');
    expect(order).toContain('cache-drained');
    order.push('filesystem-close');
    return close();
  });
  const closing = owner.app.close();
  expect(closed).not.toHaveBeenCalled();
  release();
  const token = await session;
  await refresh;
  await closing;
  expect(order.at(-1)).toBe('filesystem-close');
  expect(
    JSON.parse(await readFile(sessions, 'utf8')).some(
      ([stored]: [string, unknown]) => stored === token
    )
  ).toBe(true);
  expect(JSON.parse(await readFile(cache, 'utf8')).models).toMatchObject([
    { id: 'codex-shutdown' },
  ]);
  await expect(owner.auth.createSession()).rejects.toThrow('not available');
  await expect(owner.cache.getModels()).rejects.toThrow('shutting down');
});
