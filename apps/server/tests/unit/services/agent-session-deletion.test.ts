import { mkdtemp, readFile, writeFile, stat, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as secureFs from '../../../src/lib/secure-fs.js';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../../src/services/agent/agent-execution-coordinator.js';
import { AgentQueueDeliveryStore } from '../../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionDeletion } from '../../../src/services/agent/agent-session-deletion.js';
import { AgentSessionLoader } from '../../../src/services/agent/agent-session-loader.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import * as utils from '@automaker/utils';
import { AgentExecutionStore } from '../../../src/services/agent/agent-execution-store.js';

describe('retry-safe agent session deletion', () => {
  const id = 'one-test';
  const other = 'one-test-more';
  const prompt = { id: 'queued', message: 'private queued prompt', addedAt: 'now' };
  let directory: string;
  function application() {
    const repository = new AgentSessionRepository(directory);
    const sessions = new AgentSessionRegistry();
    const executions = new AgentExecutionCoordinator();
    const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
    const runs = new AgentExecutionStore(directory, repository, sessions, deliveries);
    const deletion = new AgentSessionDeletion(repository, sessions, executions, deliveries, runs);
    const loader = new AgentSessionLoader(repository, sessions, directory, deliveries, runs);
    return { repository, sessions, executions, deliveries, deletion, loader, runs };
  }
  let app: ReturnType<typeof application>;
  const artifact = (name: string) => path.join(directory, 'agent-sessions', name);
  const marker = () => path.join(directory, 'agent-session-deletions', `${id}.json`);
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-session-deletion-'));
    app = application();
    await app.repository.initialize();
    for (const sessionId of [id, other]) {
      await app.repository.addMetadata({
        id: sessionId,
        name: 'Fixture',
        workingDirectory: directory,
        createdAt: 'now',
        updatedAt: 'now',
      });
      await app.repository.saveMessages(sessionId, [
        { id: 'message', role: 'user', content: 'private conversation', timestamp: 'now' },
      ]);
      await app.repository.saveQueue(sessionId, [prompt]);
      await app.deliveries.claim(sessionId, prompt);
      await app.runs.begin(sessionId, {
        id: 'message',
        role: 'user',
        content: 'private conversation',
        timestamp: 'now',
      });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.repository.drain();
    await app.deliveries.onApplicationShutdown();
    await app.runs.onApplicationShutdown();
    await rm(directory, { recursive: true, force: true });
  });

  it('removes only owned artifacts and scrubs shared metadata snapshots', async () => {
    const bases = [
      artifact(`${id}.json`),
      artifact(`${id}-queue.json`),
      path.join(directory, 'agent-queue-deliveries', `${id}.json`),
      path.join(directory, 'agent-executions', `${id}.json`),
    ];
    for (const file of bases) {
      for (const suffix of [
        '.bak1',
        '.bak12',
        '.tmp.1234567890.abcdef12',
        '.bak1.tmp.1234567890.abcdef12',
        '.tmp.1234567890.abcdef12.tmp.1234567891.abcdef34',
        '.keep',
        '.bakx',
      ])
        await writeFile(file + suffix, 'private data');
    }
    const metadata = path.join(directory, 'sessions-metadata.json');
    const snapshot = await readFile(metadata, 'utf8');
    await writeFile(metadata + '.tmp.1234567890.abcdef12', snapshot);
    await writeFile(metadata + '.bak1.tmp.1234567890.abcdef12', snapshot);
    await writeFile(metadata + '.tmp.1234567890.abcdef12.tmp.1234567891.abcdef34', snapshot);
    expect(await app.deletion.remove(id)).toBe(true);
    for (const file of bases) {
      for (const suffix of [
        '',
        '.bak1',
        '.bak12',
        '.tmp.1234567890.abcdef12',
        '.bak1.tmp.1234567890.abcdef12',
        '.tmp.1234567890.abcdef12.tmp.1234567891.abcdef34',
      ])
        await expect(stat(file + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
      for (const suffix of ['.keep', '.bakx'])
        expect(await readFile(file + suffix, 'utf8')).toBe('private data');
    }
    for (const file of (await readdir(directory)).filter((name) =>
      name.startsWith('sessions-metadata.json')
    )) {
      const stored = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      expect(stored).not.toHaveProperty(id);
      // Backups created before the second session need not contain it.
      if (Object.hasOwn(stored, other)) expect(stored[other].id).toBe(other);
    }
    expect(await app.repository.loadMessages(other)).toHaveLength(1);
    expect(await app.repository.loadQueue(other)).toEqual([prompt]);
    expect(app.deliveries.isOwned(id)).toBe(false);
    expect(app.deliveries.isOwned(other)).toBe(true);
    expect(JSON.parse(await readFile(marker(), 'utf8'))).toEqual({
      version: 1,
      sessionId: id,
      phase: 'deleted',
      createdAt: expect.any(String),
      completedAt: expect.any(String),
    });
    if (process.platform !== 'win32') expect((await stat(marker())).mode & 0o777).toBe(0o600);
    expect(await app.deletion.remove(id)).toBe(false);
    expect(await app.deletion.remove('absent')).toBe(false);
  });

  it('keeps deletion authoritative after partial unlink failure and retries after restart', async () => {
    const original = secureFs.unlink;
    const fault = vi.spyOn(secureFs, 'unlink').mockImplementation(async (file) => {
      if (String(file) === artifact(`${id}.json`))
        throw Object.assign(new Error('private filesystem error'), { code: 'EACCES' });
      return original(file);
    });
    await expect(app.deletion.remove(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(await app.repository.deletionState(id)).toMatchObject({ phase: 'deleting' });
    expect(await app.repository.loadMetadata()).not.toHaveProperty(id);
    expect(await app.loader.ensure(id)).toBeNull();
    expect(await app.repository.loadMessages(id)).toEqual([]);
    expect(await app.repository.loadQueue(id)).toEqual([]);
    await expect(app.repository.saveQueue(id, [prompt])).rejects.toThrow('deleted');
    await expect(app.repository.saveMessages(id, [])).rejects.toThrow('deleted');
    await expect(app.repository.updateMetadata(id, { name: 'resurrected' })).rejects.toThrow(
      'deleted'
    );
    fault.mockRestore();
    const restarted = application();
    expect(await restarted.loader.ensure(id)).toBeNull();
    expect(await restarted.deletion.remove(id)).toBe(true);
    expect(await restarted.repository.deletionState(id)).toMatchObject({ phase: 'deleted' });
    expect(await restarted.repository.loadMessages(other)).toHaveLength(1);
  });

  it('does not remove data when persisting deletion intent fails', async () => {
    const fault = vi
      .spyOn(app.repository, 'markForDeletion')
      .mockRejectedValueOnce(new AgentSessionStorageError('write'));
    await expect(app.deletion.remove(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(await app.repository.deletionState(id)).toBeUndefined();
    expect(await app.repository.loadMessages(id)).toHaveLength(1);
    expect(await app.repository.loadQueue(id)).toEqual([prompt]);
    expect(await app.repository.loadMetadata()).toHaveProperty(id);
    fault.mockRestore();
    expect(await app.deletion.remove(id)).toBe(true);
  });

  it('drains an already admitted file writer before returning successful cleanup', async () => {
    const original = utils.atomicWriteJson;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const writer = vi
      .spyOn(utils, 'atomicWriteJson')
      .mockImplementation(async (file, data, options) => {
        if (file === artifact(`${id}.json`)) {
          entered();
          await gate;
        }
        return original(file, data, options);
      });
    const pending = app.repository.saveMessages(id, []);
    await started;
    const removal = app.deletion.remove(id);
    try {
      await vi.waitFor(async () =>
        expect(await app.repository.deletionState(id)).toMatchObject({ phase: 'deleting' })
      );
    } finally {
      release();
    }
    await pending;
    expect(await removal).toBe(true);
    writer.mockRestore();
    await expect(stat(artifact(`${id}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(artifact(`${id}.json.bak1`))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['metadata', 'completion'] as const)(
    'retries after %s failure even when metadata is already absent',
    async (checkpoint) => {
      const method = checkpoint === 'metadata' ? 'purgeMetadataSnapshots' : 'completeDeletion';
      const fault = vi
        .spyOn(app.repository, method)
        .mockRejectedValueOnce(new AgentSessionStorageError('write'));
      await expect(app.deletion.remove(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
      expect(
        JSON.parse(await readFile(path.join(directory, 'sessions-metadata.json'), 'utf8'))
      ).not.toHaveProperty(id);
      fault.mockRestore();
      expect(await application().deletion.remove(id)).toBe(true);
    }
  );

  it('cannot resurrect from stale metadata or a late delivery completion', async () => {
    const stale = await app.repository.loadMetadata();
    const delivery = JSON.parse(
      await readFile(path.join(directory, 'agent-queue-deliveries', `${id}.json`), 'utf8')
    );
    await app.deletion.remove(id);
    await app.repository.saveMetadata(stale);
    expect(await app.repository.loadMetadata()).not.toHaveProperty(id);
    await expect(app.repository.addMetadata(stale[id])).rejects.toThrow('deleted');
    await expect(app.deliveries.finish(delivery)).rejects.toThrow('ownership');
    await expect(app.deliveries.claim(id, prompt)).rejects.toThrow('deleted');
    // Even corrupt stale journal must not bypass the tombstone or break loading.
    await writeFile(path.join(directory, 'agent-queue-deliveries', `${id}.json`), 'corrupt');
    expect(await application().loader.ensure(id)).toBeNull();
    const metadata = path.join(directory, 'sessions-metadata.json');
    await writeFile(metadata + '.bak1', JSON.stringify(stale));
    await writeFile(metadata, 'corrupt');
    expect(await application().repository.loadMetadata()).not.toHaveProperty(id);
  });

  it('fails closed on corrupt tombstone without rolling back to a backup', async () => {
    await app.repository.markForDeletion(id);
    await writeFile(
      marker() + '.bak1',
      JSON.stringify({ version: 1, sessionId: id, phase: 'deleted', createdAt: 'now' })
    );
    await writeFile(marker(), 'corrupt');
    const restarted = application();
    await expect(restarted.loader.ensure(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    await expect(restarted.repository.loadMetadata()).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
  });

  it('preserves a corrupt shared snapshot instead of deleting unrelated recovery data', async () => {
    const backup = path.join(directory, 'sessions-metadata.json.bak123');
    await writeFile(backup, 'corrupt shared recovery data');
    await expect(app.deletion.remove(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(await readFile(backup, 'utf8')).toBe('corrupt shared recovery data');
    await writeFile(backup, JSON.stringify(await app.repository.loadMetadata()));
    expect(await app.deletion.remove(id)).toBe(true);
  });
});
