import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import * as secureFs from '../../../src/lib/secure-fs.js';
import { secureFs as platformFs } from '@automaker/platform';
import type {
  ActiveSession,
  SessionMetadata,
} from '../../../src/services/agent/agent-session.types.js';

const active = (): ActiveSession => ({
  messages: [],
  isRunning: false,
  abortController: null,
  workingDirectory: '/project',
  promptQueue: [],
});
const metadata = (id: string): SessionMetadata => ({
  id,
  name: id,
  workingDirectory: '/project',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('AgentSessionRegistry', () => {
  it('hydrates a session once for concurrent callers and returns the identical active instance', async () => {
    const registry = new AgentSessionRegistry();
    const session = active();
    const load = vi.fn(async () => session);
    const [first, second] = await Promise.all([
      registry.getOrLoad('one', load),
      registry.getOrLoad('one', load),
    ]);
    expect(first).toBe(session);
    expect(second).toBe(session);
    expect(load).toHaveBeenCalledTimes(1);
    expect(registry.getOrCreate('one', active)).toBe(session);
    expect(registry.size).toBe(1);
    expect(new AgentSessionRegistry().get('one')).toBeUndefined();
  });

  it('does not retain failed hydration and retries the next request', async () => {
    const registry = new AgentSessionRegistry();
    await expect(
      registry.getOrLoad('one', async () => {
        throw new Error('fixture');
      })
    ).rejects.toThrow('fixture');
    const session = active();
    expect(await registry.getOrLoad('one', async () => session)).toBe(session);
  });

  it.each(['delete', 'shutdown'])(
    'does not resurrect a session after %s during hydration',
    async (action) => {
      const registry = new AgentSessionRegistry();
      let release!: (value: ActiveSession) => void;
      const pending = registry.getOrLoad(
        'one',
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      await Promise.resolve();
      if (action === 'delete') registry.delete('one');
      else await registry.onApplicationShutdown();
      release(active());
      expect(await pending).toBeNull();
      expect(registry.size).toBe(0);
    }
  );
});

describe('AgentSessionRepository', () => {
  let directory: string, repository: AgentSessionRepository;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-agent-state-'));
    repository = new AgentSessionRepository(directory);
    await repository.initialize();
  });
  afterEach(async () => {
    await repository.drain();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('propagates read I/O errors without consulting a backup or returning empty state', async () => {
    const read = vi
      .spyOn(secureFs, 'readFile')
      .mockRejectedValueOnce(Object.assign(new Error('private path'), { code: 'EACCES' }));
    await expect(repository.loadMetadata()).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(['{"private prompt":', '[]', '{"session":null}'])(
    'does not overwrite corrupt metadata %s',
    async (content) => {
      const file = path.join(directory, 'sessions-metadata.json');
      await writeFile(file, content);
      await expect(repository.addMetadata(metadata('new-session'))).rejects.toMatchObject({
        errorCode: 'UNAVAILABLE',
        statusCode: 503,
      });
      expect(await readFile(file, 'utf8')).toBe(content);
      const error = await repository.loadMetadata().catch((error: Error) => error);
      expect(String(error)).not.toContain(content);
    }
  );

  it('recovers corrupt metadata from a validated committed backup without auto-restoring on read', async () => {
    const file = path.join(directory, 'sessions-metadata.json');
    await writeFile(file, '{broken');
    await writeFile(`${file}.bak1`, '[]');
    await writeFile(`${file}.bak2`, JSON.stringify({ old: metadata('old') }));
    expect(Object.keys(await repository.loadMetadata())).toEqual(['old']);
    expect(await readFile(file, 'utf8')).toBe('{broken');
    await repository.addMetadata(metadata('new-session'));
    expect(Object.keys(await repository.loadMetadata()).sort()).toEqual(['new-session', 'old']);
  });

  it('does not recover absent main files or uncommitted temp data', async () => {
    const file = path.join(directory, 'agent-sessions', 'one.json');
    const messages = [{ id: 'message', role: 'user', content: 'old', timestamp: 'now' }];
    await writeFile(`${file}.bak1`, JSON.stringify(messages));
    expect(await repository.loadMessages('one')).toEqual([]);
    await rm(`${file}.bak1`);
    await writeFile(file, '{}');
    await writeFile(`${file}.tmp.uncommitted`, JSON.stringify(messages));
    await expect(repository.loadMessages('one')).rejects.toBeInstanceOf(AgentSessionStorageError);
    await writeFile(file, JSON.stringify([{ ...messages[0], role: ['user'] }]));
    await expect(repository.loadMessages('one')).rejects.toBeInstanceOf(AgentSessionStorageError);
  });

  it('returns safe write failures and allows a later write after recovery', async () => {
    await repository.saveMessages('one', []);
    const realRename = platformFs.rename;
    const rename = vi.spyOn(platformFs, 'rename').mockImplementation(async (source, target) => {
      if (String(target) === path.join(directory, 'agent-sessions', 'one.json'))
        throw new Error('private filesystem detail');
      return realRename(source, target);
    });
    await expect(repository.saveMessages('one', [])).rejects.toMatchObject({
      operation: 'write',
      statusCode: 503,
    });
    rename.mockRestore();
    expect(await repository.loadMessages('one')).toEqual([]);
    await expect(repository.saveMessages('one', [])).resolves.toBeUndefined();
  });

  it('retains every session across concurrent metadata creations and updates', async () => {
    await Promise.all(
      Array.from({ length: 16 }, (_, index) => repository.addMetadata(metadata(`session-${index}`)))
    );
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        repository.updateMetadata(`session-${index}`, { name: `updated-${index}` })
      )
    );
    const all = await new AgentSessionRepository(directory).loadMetadata();
    expect(Object.keys(all)).toHaveLength(16);
    for (let index = 0; index < 16; index++)
      expect(all[`session-${index}`].name).toBe(`updated-${index}`);
    expect((await readdir(directory)).some((file) => file.includes('.tmp.'))).toBe(false);
  });

  it('preserves the message/queue paths, snapshots mutable arrays and restores them after restart', async () => {
    const messages = [
      { id: 'message', role: 'user' as const, content: 'original', timestamp: 'now' },
    ];
    const queue = [{ id: 'queued', message: 'next', addedAt: 'now', providerId: 'endpoint' }];
    const saving = Promise.all([
      repository.saveMessages('one', messages),
      repository.saveQueue('one', queue),
    ]);
    messages[0].content = 'mutated';
    queue.length = 0;
    await saving;
    const restarted = new AgentSessionRepository(directory);
    expect((await restarted.loadMessages('one'))[0].content).toBe('original');
    expect(await restarted.loadQueue('one')).toHaveLength(1);
    expect(await readFile(path.join(directory, 'agent-sessions', 'one.json'), 'utf8')).toContain(
      'original'
    );
    expect(
      await readFile(path.join(directory, 'agent-sessions', 'one-queue.json'), 'utf8')
    ).toContain('endpoint');
  });

  it('serializes clearing SDK continuity without losing an unrelated metadata change', async () => {
    await repository.addMetadata({ ...metadata('one'), sdkSessionId: 'old-sdk-session' });
    await Promise.all([
      repository.updateMetadata('one', { name: 'renamed' }),
      repository.clearSdkSessionId('one'),
    ]);
    const session = (await repository.loadMetadata()).one;
    expect(session.name).toBe('renamed');
    expect(session.sdkSessionId).toBeUndefined();
    expect(await repository.deleteMetadata('one')).toBe(true);
    expect(await repository.deleteMetadata('one')).toBe(false);
  });

  it.each(['../outside', '/absolute', '..\\outside', '__proto__', 'constructor'])(
    'rejects unsafe file/session ID %s before writing',
    async (id) => {
      expect(() => repository.saveMessages(id, [])).toThrow();
      expect(() => repository.saveQueue(id, [])).toThrow();
      expect(() => repository.addMetadata(metadata(id))).toThrow();
      expect(await readdir(directory)).toEqual(['agent-sessions']);
    }
  );
});
