import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as utils from '@automaker/utils';
import { AgentExecutionStore } from '../../../src/services/agent/agent-execution-store.js';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentQueueDeliveryStore } from '../../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import { createTestAgentState, createTestAgentEvents } from '../../helpers/agent-state.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import type { Message } from '../../../src/services/agent/agent-session.types.js';

describe('durable agent execution intent and recovery', () => {
  const id = 'execution-session';
  const user: Message = {
    id: 'request',
    role: 'user',
    content: 'private request',
    timestamp: 'now',
  };
  let directory: string,
    repository: AgentSessionRepository,
    sessions: AgentSessionRegistry,
    store: AgentExecutionStore;
  const journal = () => path.join(directory, 'agent-executions', `${id}.json`);
  const restart = () => {
    const restartedSessions = new AgentSessionRegistry();
    return new AgentExecutionStore(
      directory,
      repository,
      restartedSessions,
      new AgentQueueDeliveryStore(directory, repository, restartedSessions)
    );
  };
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-execution-store-'));
    repository = new AgentSessionRepository(directory);
    sessions = new AgentSessionRegistry();
    store = new AgentExecutionStore(
      directory,
      repository,
      sessions,
      new AgentQueueDeliveryStore(directory, repository, sessions)
    );
    await repository.initialize();
    await repository.addMetadata({
      id,
      name: 'Fixture',
      workingDirectory: directory,
      createdAt: 'now',
      updatedAt: 'now',
      sdkSessionId: 'unknown-sdk',
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await store.onApplicationShutdown();
    await repository.drain();
    await rm(directory, { recursive: true, force: true });
  });
  it('persists a private run before history and skips recovery of its live owner', async () => {
    const run = await store.begin(id, user);
    expect(JSON.parse(await readFile(journal(), 'utf8'))).toMatchObject({
      phase: 'running',
      runId: run.runId,
      userMessage: { ...user, runId: run.runId },
    });
    if (process.platform !== 'win32') expect((await stat(journal())).mode & 0o777).toBe(0o600);
    expect(await repository.loadMessages(id)).toEqual([]);
    expect(await store.recover(id)).toBe(false);
    await expect(store.begin(id, user)).rejects.toThrow('previous');
  });
  it('marks an unknown run interrupted once and clears SDK identity without execution', async () => {
    const run = await store.begin(id, user);
    const restarted = restart();
    expect(await restarted.recover(id)).toBe(true);
    const messages = await repository.loadMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      ...user,
      runId: run.runId,
      executionStatus: 'interrupted',
    });
    expect(messages[1].content).toContain('No automatic replay');
    expect((await repository.loadMetadata())[id].sdkSessionId).toBeUndefined();
    expect(await restart().recover(id)).toBe(false);
    expect(await repository.loadMessages(id)).toEqual(messages);
  });
  it.each(['completed', 'failed', 'cancelled'] as const)(
    'finishes %s intent after history failure, even with a corrupt history main',
    async (status) => {
      const run = await store.begin(id, user);
      await repository.saveMessages(id, [run.userMessage!]);
      const messages: Message[] = [
        { ...run.userMessage!, executionStatus: status },
        { id: 'answer', role: 'assistant', content: 'Durable terminal answer', timestamp: 'now' },
      ];
      vi.spyOn(repository, 'saveMessages').mockRejectedValueOnce(
        new AgentSessionStorageError('write')
      );
      await expect(store.complete(run, messages, status, 'unknown-sdk')).rejects.toBeInstanceOf(
        AgentSessionStorageError
      );
      expect(JSON.parse(await readFile(journal(), 'utf8')).phase).toBe('completing');
      await writeFile(path.join(directory, 'agent-sessions', `${id}.json`), 'corrupt');
      expect(await restart().recover(id)).toBe(true);
      expect(await repository.loadMessages(id)).toEqual(messages);
      expect((await repository.loadMetadata())[id].sdkSessionId).toBe('unknown-sdk');
      const settled = JSON.parse(await readFile(journal(), 'utf8'));
      expect(settled).toMatchObject({ phase: 'settled', status });
      expect(settled).not.toHaveProperty('messages');
      expect(settled).not.toHaveProperty('userMessage');
      await repository.saveMessages(id, []);
      expect(await restart().recover(id)).toBe(false);
      expect(await repository.loadMessages(id)).toEqual([]);
    }
  );
  it.each(['metadata', 'settlement'] as const)(
    'retries terminal %s failure without adding an interruption',
    async (stage) => {
      const run = await store.begin(id, user);
      if (stage === 'metadata')
        vi.spyOn(repository, 'touchMetadata').mockRejectedValueOnce(
          new AgentSessionStorageError('write')
        );
      else {
        const original = utils.atomicWriteJson;
        vi.spyOn(utils, 'atomicWriteJson').mockImplementation(async (file, value, options) => {
          if (file === journal() && (value as { phase?: string }).phase === 'settled')
            throw new Error('private filesystem error');
          return original(file, value, options);
        });
      }
      await expect(store.complete(run, [run.userMessage!], 'completed')).rejects.toBeInstanceOf(
        AgentSessionStorageError
      );
      vi.restoreAllMocks();
      expect(await restart().recover(id)).toBe(true);
      expect(await repository.loadMessages(id)).toEqual([
        { ...run.userMessage!, executionStatus: 'completed' },
      ]);
    }
  );
  it('does not fabricate a terminal proof when intent persistence failed', async () => {
    const run = await store.begin(id, user);
    await repository.saveMessages(id, [run.userMessage!]);
    const original = utils.atomicWriteJson;
    vi.spyOn(utils, 'atomicWriteJson').mockImplementation(async (file, value, options) => {
      if (file === journal()) throw new Error('private write error');
      return original(file, value, options);
    });
    await expect(store.complete(run, [run.userMessage!], 'completed')).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    vi.restoreAllMocks();
    expect(await restart().recover(id)).toBe(true);
    expect((await repository.loadMessages(id))[0].executionStatus).toBe('interrupted');
  });
  it('retries partial recovery with stable IDs and no duplicate warning', async () => {
    await store.begin(id, user);
    vi.spyOn(repository, 'touchMetadata').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(restart().recover(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    const first = await repository.loadMessages(id);
    expect(await restart().recover(id)).toBe(true);
    expect(await repository.loadMessages(id)).toEqual(first);
  });
  it('fails closed on corrupt journal and ignores an older settled backup', async () => {
    await store.begin(id, user);
    await writeFile(
      journal() + '.bak1',
      JSON.stringify({ version: 1, sessionId: id, phase: 'settled', status: 'completed' })
    );
    await writeFile(journal(), 'private corrupt prompt');
    await expect(restart().recover(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    await expect(restart().recover(id)).rejects.not.toThrow('private corrupt prompt');
  });
  it('durably abandons an unstarted request but fences late completion after release', async () => {
    const run = await store.begin(id, user);
    await store.abandon(run);
    store.release(run);
    expect(await restart().recover(id)).toBe(false);
    expect(await repository.loadMessages(id)).toEqual([]);
    await expect(store.complete(run, [run.userMessage!], 'completed')).rejects.toThrow('ownership');
    const next = await store.begin(id, user);
    expect(next.runId).not.toBe(run.runId);
  });
  it('restores a queued terminal intent before queue reads decide whether to quarantine it', async () => {
    const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
    const delivery = await deliveries.claim(id, {
      id: 'queued',
      message: 'Queued request',
      addedAt: 'now',
    });
    const run = await store.begin(id, {
      ...user,
      deliveryId: delivery.deliveryId,
      queuedPromptId: 'queued',
    });
    await repository.saveQueue(id, []);
    await repository.saveMessages(id, [run.userMessage!]);
    vi.spyOn(repository, 'saveMessages').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(
      store.complete(run, [{ ...run.userMessage!, deliveryStatus: 'completed' }], 'completed')
    ).rejects.toBeInstanceOf(AgentSessionStorageError);
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    expect(await state[8].get(id)).toEqual({ success: true, queue: [] });
    expect((await state[0].loadMessages(id))[0]).toMatchObject({
      deliveryStatus: 'completed',
      executionStatus: 'completed',
    });
    expect(await state[0].loadMessages(id)).toHaveLength(1);
  });
  it('quarantines an unknown queued run with only the queue warning and no terminal proof', async () => {
    const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
    const delivery = await deliveries.claim(id, {
      id: 'queued',
      message: 'Queued request',
      addedAt: 'now',
    });
    await store.begin(id, { ...user, deliveryId: delivery.deliveryId, queuedPromptId: 'queued' });
    await repository.saveQueue(id, []);
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    const session = await state[6].ensure(id);
    expect(session?.promptQueue[0]).toMatchObject({ id: 'queued', deliveryStatus: 'interrupted' });
    expect(session?.messages).toHaveLength(2);
    expect(session?.messages[0]).toMatchObject({ executionStatus: 'interrupted' });
    expect(session?.messages[0].deliveryStatus).toBeUndefined();
    expect(session?.messages[1].id).toContain('msg_queue_recovery_');
  });
  it('honors deletion before reading a corrupt journal and purges all owned artifacts', async () => {
    const run = await store.begin(id, user);
    await repository.markForDeletion(id);
    await writeFile(journal(), 'private corrupt prompt');
    await writeFile(journal() + '.bak1', 'private backup');
    await writeFile(journal() + '.tmp.123.abcdef12', 'private temp');
    expect(await restart().recover(id)).toBe(false);
    await store.purge(id);
    for (const suffix of ['', '.bak1', '.tmp.123.abcdef12'])
      await expect(stat(journal() + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.complete(run, [run.userMessage!], 'completed')).rejects.toThrow('ownership');
    await expect(store.begin(id, user)).rejects.toThrow('deleted');
  });

  it('settles a pending intent before explicit clear, so cold hydration cannot restore cleared history', async () => {
    const run = await store.begin(id, user);
    await repository.saveMessages(id, [run.userMessage!]);
    vi.spyOn(repository, 'saveMessages').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(store.complete(run, [run.userMessage!], 'completed')).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    expect(await state[7].clear(id)).toEqual({ success: true });
    expect(await state[0].loadMessages(id)).toEqual([]);
    const restarted = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    expect((await restarted[6].ensure(id))?.messages).toEqual([]);
  });

  it('commits queue consumption before execution settles, even if history is cleared before queue.finish', async () => {
    const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
    const delivery = await deliveries.claim(id, {
      id: 'queued',
      message: 'Queued request',
      addedAt: 'now',
    });
    const run = await store.begin(id, {
      ...user,
      deliveryId: delivery.deliveryId,
      queuedPromptId: 'queued',
    });
    await repository.saveQueue(id, []);
    await store.complete(run, [{ ...run.userMessage!, deliveryStatus: 'completed' }], 'completed');
    await repository.saveMessages(id, []);
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    const session = await state[6].ensure(id);
    expect(session?.promptQueue).toEqual([]);
    expect(session?.messages).toEqual([]);
  });

  it('keeps terminal intent recoverable if committing queue consumption fails', async () => {
    const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
    const delivery = await deliveries.claim(id, {
      id: 'queued',
      message: 'Queued request',
      addedAt: 'now',
    });
    const run = await store.begin(id, {
      ...user,
      deliveryId: delivery.deliveryId,
      queuedPromptId: 'queued',
    });
    await repository.saveQueue(id, []);
    vi.spyOn(AgentQueueDeliveryStore.prototype, 'consumeExecution').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(
      store.complete(run, [{ ...run.userMessage!, deliveryStatus: 'completed' }], 'completed')
    ).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(JSON.parse(await readFile(journal(), 'utf8')).phase).toBe('completing');
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
    expect((await state[6].ensure(id))?.promptQueue).toEqual([]);
    expect(JSON.parse(await readFile(journal(), 'utf8')).phase).toBe('settled');
  });
});
