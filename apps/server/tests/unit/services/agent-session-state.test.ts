import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
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
      else registry.onApplicationShutdown();
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
    await rm(directory, { recursive: true, force: true });
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
