import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRuntimeConfig } from '../../../src/core/config/index.js';
import { AuthStateRepository } from '../../../src/core/auth/auth-state.repository.js';
import * as secureFs from '../../../src/lib/secure-fs.js';

let directory: string;
let stores: AuthStateRepository[];
async function open(name = 'first', apiKey: string | null = 'fixture-key') {
  const store = new AuthStateRepository(
    parseRuntimeConfig({
      DATA_DIR: path.join(directory, name),
      AUTOMAKER_API_KEY: apiKey ?? undefined,
    })
  );
  stores.push(store);
  await store.onModuleInit();
  return store;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'auth-repository-'));
  stores = [];
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(stores.map((store) => store.onApplicationShutdown()));
  await rm(directory, { recursive: true, force: true });
});

describe('AuthStateRepository', () => {
  it('isolates keys, sessions and single-use WS tokens between application instances', async () => {
    const first = await open('first', 'first-key');
    const second = await open('second', 'second-key');
    expect(first.validateApiKey('first-key')).toBe(true);
    expect(second.validateApiKey('first-key')).toBe(false);
    const session = await first.createSession();
    expect(first.validateSession(session)).toBe(true);
    expect(second.validateSession(session)).toBe(false);
    const token = first.issueWebSocketToken();
    expect(second.consumeWebSocketToken(token)).toBe(false);
    expect(first.consumeWebSocketToken(token)).toBe(true);
    expect(first.consumeWebSocketToken(token)).toBe(false);
  });

  it('generates and reloads the existing API key format without revealing it in logs', async () => {
    const logs = ['log', 'info', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined)
    );
    const first = await open('generated', null);
    const keyFile = path.join(directory, 'generated', '.api-key');
    const key = await readFile(keyFile, 'utf8');
    expect(key.length).toBeGreaterThan(0);
    expect(first.validateApiKey(key)).toBe(true);
    const second = await open('generated', null);
    expect(second.validateApiKey(key)).toBe(true);
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(key);
    if (process.platform !== 'win32') expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
  });

  it('uses the configured key without overwriting a saved key or reading process.env', async () => {
    const folder = path.join(directory, 'configured');
    await mkdir(folder);
    await writeFile(path.join(folder, '.api-key'), 'saved-key');
    vi.stubEnv('AUTOMAKER_API_KEY', 'unrelated-global-key');
    try {
      const store = await open('configured', 'configured-key');
      expect(store.validateApiKey('configured-key')).toBe(true);
      expect(store.validateApiKey('saved-key')).toBe(false);
      expect(store.validateApiKey('unrelated-global-key')).toBe(false);
      expect(await readFile(path.join(folder, '.api-key'), 'utf8')).toBe('saved-key');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('loads compatible session tuples and ignores malformed or expired entries', async () => {
    const folder = path.join(directory, 'legacy');
    await mkdir(folder);
    const now = Date.now();
    await writeFile(
      path.join(folder, '.sessions'),
      JSON.stringify([
        ['valid', { createdAt: now - 100, expiresAt: now + 10000 }],
        ['expired', { createdAt: now - 100, expiresAt: now - 1 }],
        ['invalid', { createdAt: 'bad', expiresAt: now + 10000 }],
        ['reverse', { createdAt: now + 20000, expiresAt: now + 10000 }],
        ['missing', null],
        null,
        ['short'],
      ])
    );
    const store = await open('legacy');
    expect(store.validateSession('valid')).toBe(true);
    for (const token of ['expired', 'invalid', 'reverse', 'missing', 'short'])
      expect(store.validateSession(token)).toBe(false);
  });

  it.each(['not JSON', '{}', 'null'])(
    'fails closed for malformed persisted sessions %s',
    async (data) => {
      const folder = path.join(directory, 'corrupt');
      await mkdir(folder);
      await writeFile(path.join(folder, '.sessions'), data);
      const store = await open('corrupt');
      expect(store.validateSession('anything')).toBe(false);
      expect(store.validateApiKey('fixture-key')).toBe(true);
    }
  );

  it('serializes concurrent mutations, retains sessions across restart and persists logout', async () => {
    const first = await open();
    const tokens = await Promise.all(Array.from({ length: 24 }, () => first.createSession()));
    expect(new Set(tokens).size).toBe(24);
    await Promise.all(tokens.slice(0, 12).map((token) => first.invalidateSession(token)));
    await first.onApplicationShutdown();
    const restarted = await open();
    for (const token of tokens.slice(0, 12)) expect(restarted.validateSession(token)).toBe(false);
    for (const token of tokens.slice(12)) expect(restarted.validateSession(token)).toBe(true);
    const folder = path.join(directory, 'first');
    expect(JSON.parse(await readFile(path.join(folder, '.sessions'), 'utf8'))).toHaveLength(12);
    expect(await readdir(folder)).toEqual(['.sessions']);
    if (process.platform !== 'win32')
      expect((await stat(path.join(folder, '.sessions'))).mode & 0o777).toBe(0o600);
  });

  it('does not authenticate an unpersisted session and recovers after a failed atomic rename', async () => {
    const store = await open();
    const first = await store.createSession();
    const rename = vi
      .spyOn(secureFs, 'rename')
      .mockRejectedValueOnce(new Error('fixture I/O failure'));
    await expect(store.createSession()).rejects.toThrow('fixture I/O failure');
    const folder = path.join(directory, 'first');
    expect(JSON.parse(await readFile(path.join(folder, '.sessions'), 'utf8'))).toHaveLength(1);
    expect(await readdir(folder)).toEqual(['.sessions']);
    expect(store.validateSession(first)).toBe(true);
    const second = await store.createSession();
    expect(store.validateSession(second)).toBe(true);
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it('drains pending writes at shutdown and rejects operations on a closed store', async () => {
    const store = await open();
    const pending = store.createSession();
    const closing = store.onApplicationShutdown();
    const token = await pending;
    await closing;
    expect(store.validateSession(token)).toBe(false);
    expect(store.validateApiKey('fixture-key')).toBe(false);
    await expect(store.createSession()).rejects.toThrow('not available');
    expect(() => store.issueWebSocketToken()).toThrow('not available');
    const restarted = await open();
    expect(restarted.validateSession(token)).toBe(true);
  });

  it('does not reload short-lived WS tokens after restart', async () => {
    const store = await open();
    const token = store.issueWebSocketToken();
    await store.onApplicationShutdown();
    const restarted = await open();
    expect(restarted.consumeWebSocketToken(token)).toBe(false);
  });
});
