import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as utils from '@automaker/utils';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentQueueDeliveryStore } from '../../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import type { QueuedPrompt, Message } from '../../../src/services/agent/agent-session.types.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import { createTestAgentState, createTestAgentEvents } from '../../helpers/agent-state.js';
import { createTestAgentProviders } from '../../helpers/agent-state.js';
import { AgentService } from '../../../src/services/agent-service.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../../helpers/mock-provider.js';

describe('durable queued delivery recovery', () => {
  const id = 'delivery-session';
  const first: QueuedPrompt = {
    id: 'first',
    message: 'Private queued request',
    model: 'direct-Exact/Model',
    providerId: 'endpoint',
    imagePaths: ['/fixture.png'],
    thinkingLevel: 'high',
    addedAt: 'now',
  };
  const later: QueuedPrompt = { id: 'later', message: 'Later request', addedAt: 'now' };
  let directory: string,
    repository: AgentSessionRepository,
    sessions: AgentSessionRegistry,
    store: AgentQueueDeliveryStore;
  const journal = () => path.join(directory, 'agent-queue-deliveries', `${id}.json`);
  const restarted = () =>
    new AgentQueueDeliveryStore(directory, repository, new AgentSessionRegistry());
  const terminal = (
    deliveryId: string,
    promptId: string,
    deliveryStatus: Message['deliveryStatus']
  ): Message => ({
    id: `user-${deliveryId}`,
    role: 'user',
    content: 'Request',
    timestamp: 'now',
    deliveryId,
    queuedPromptId: promptId,
    deliveryStatus,
  });
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-queue-delivery-'));
    repository = new AgentSessionRepository(directory);
    sessions = new AgentSessionRegistry();
    store = new AgentQueueDeliveryStore(directory, repository, sessions);
    await repository.initialize();
    await repository.addMetadata({
      id,
      name: 'Fixture',
      workingDirectory: directory,
      createdAt: 'now',
      updatedAt: 'now',
    });
    await repository.saveQueue(id, [first, later]);
  });
  afterEach(async () => {
    await store.onApplicationShutdown();
    await repository.drain();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists a private claim before dequeue and does not recover a live owner', async () => {
    const delivery = await store.claim(id, first);
    expect(JSON.parse(await readFile(journal(), 'utf8'))).toMatchObject({
      phase: 'claimed',
      deliveryId: delivery.deliveryId,
      prompt: first,
    });
    if (process.platform !== 'win32') expect((await stat(journal())).mode & 0o777).toBe(0o600);
    expect(await store.recover(id)).toBe(false);
    expect(await repository.loadQueue(id)).toEqual([first, later]);
    expect(await repository.loadMessages(id)).toEqual([]);
  });
  it.each([false, true])(
    'quarantines an unfinished request across restart (dequeued=%s), never auto-replaying it',
    async (dequeued) => {
      await store.claim(id, first);
      if (dequeued) await repository.saveQueue(id, [later]);
      const recovery = restarted();
      expect(await recovery.recover(id)).toBe(true);
      const queue = await repository.loadQueue(id);
      expect(queue[0]).toMatchObject({ ...first, deliveryStatus: 'interrupted' });
      expect(queue.map((prompt) => prompt.id)).toEqual(['first', 'later']);
      const messages = await repository.loadMessages(id);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain('No automatic replay');
      await recovery.recover(id);
      expect(await repository.loadMessages(id)).toEqual(messages);
      const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()));
      await state[6].ensure(id);
      const execute = vi.fn();
      await state[8].process(id, execute);
      expect(execute).not.toHaveBeenCalled();
      expect(await repository.loadQueue(id)).toHaveLength(2);
    }
  );
  it.each(['completed', 'failed', 'cancelled'] as const)(
    'recognizes durable %s even if the process died before journal settlement',
    async (status) => {
      const delivery = await store.claim(id, first);
      await repository.saveQueue(id, [later]);
      await repository.saveMessages(id, [terminal(delivery.deliveryId, first.id, status)]);
      expect(await restarted().recover(id)).toBe(false);
      expect(await repository.loadQueue(id)).toEqual([later]);
      expect(await repository.loadMessages(id)).toHaveLength(1);
      expect(JSON.parse(await readFile(journal(), 'utf8'))).toMatchObject({
        phase: 'settled',
        disposition: 'consumed',
      });
    }
  );
  it('does not resurrect earlier completed deliveries from a stale queue backup', async () => {
    const one = await store.claim(id, first);
    await store.finish(one);
    store.release(one);
    const two = await store.claim(id, later);
    await store.finish(two);
    store.release(two);
    await repository.saveMessages(id, [
      terminal(one.deliveryId, first.id, 'completed'),
      terminal(two.deliveryId, later.id, 'completed'),
    ]);
    await repository.saveQueue(id, [first, later]);
    await repository.saveQueue(id, []);
    await writeFile(path.join(directory, 'agent-sessions', `${id}-queue.json`), '{broken');
    await restarted().recover(id);
    expect(await repository.loadQueue(id)).toEqual([]);
  });
  it('keeps quarantine even if an old queue snapshot loses the interrupted flag', async () => {
    await store.claim(id, first);
    const recovery = restarted();
    await recovery.recover(id);
    await repository.saveQueue(id, [first, later]);
    await recovery.recover(id);
    expect((await repository.loadQueue(id))[0].deliveryStatus).toBe('interrupted');
    expect(await repository.loadMessages(id)).toHaveLength(1);
  });

  it('retains consumed IDs across history clearing and later deliveries', async () => {
    const one = await store.claim(id, first);
    await store.finish(one);
    store.release(one);
    const two = await store.claim(id, later);
    await store.finish(two);
    store.release(two);
    await repository.saveMessages(id, []);
    await repository.saveQueue(id, [first, later]);
    await restarted().recover(id);
    expect(await repository.loadQueue(id)).toEqual([]);
    expect(await repository.loadMessages(id)).toEqual([]);
  });

  it('retains quarantine IDs across explicit removal, history clearing and a later completed delivery', async () => {
    await store.claim(id, first);
    const recovery = restarted();
    await recovery.recover(id);
    await repository.saveQueue(id, [later]);
    const next = await recovery.claim(id, later);
    await recovery.finish(next);
    recovery.release(next);
    await repository.saveMessages(id, []);
    await repository.saveQueue(id, [first, later]);
    await restarted().recover(id);
    const queue = await repository.loadQueue(id);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: 'first', deliveryStatus: 'interrupted' });
  });
  it('respects explicit removal of a quarantined request', async () => {
    await store.claim(id, first);
    const recovery = restarted();
    await recovery.recover(id);
    await repository.saveQueue(id, [later]);
    await recovery.recover(id);
    expect(await repository.loadQueue(id)).toEqual([later]);
  });
  it('resumes partial recovery idempotently after a marker write fails', async () => {
    await store.claim(id, first);
    await repository.saveQueue(id, [later]);
    vi.spyOn(repository, 'saveMessages').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(restarted().recover(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect((await repository.loadQueue(id))[0].deliveryStatus).toBe('interrupted');
    await restarted().recover(id);
    await restarted().recover(id);
    expect(await repository.loadMessages(id)).toHaveLength(1);
    expect(await repository.loadQueue(id)).toHaveLength(2);
  });
  it('fails closed on a corrupt journal without rolling back to an older settled backup', async () => {
    const delivery = await store.claim(id, first);
    await writeFile(
      `${journal()}.bak1`,
      JSON.stringify({ ...delivery, phase: 'settled', disposition: 'consumed' })
    );
    await writeFile(journal(), '{broken private request');
    await expect(restarted().recover(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(await repository.loadQueue(id)).toEqual([first, later]);
  });
  it('does not mutate the queue or retain live ownership if claim persistence fails', async () => {
    vi.spyOn(utils, 'atomicWriteJson').mockRejectedValueOnce(
      new Error('Fixture private write failure')
    );
    await expect(store.claim(id, first)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(store.isOwned(id)).toBe(false);
    expect(await repository.loadQueue(id)).toEqual([first, later]);
  });
  it('never recreates messages after session metadata was deleted', async () => {
    await store.claim(id, first);
    await repository.saveQueue(id, [later]);
    await repository.deleteMetadata(id);
    await repository.deleteMessages(id);
    expect(await restarted().recover(id)).toBe(false);
    expect(await repository.loadMessages(id)).toEqual([]);
  });

  it('reports settlement failure after an executor error without leaking an unhandled rejection or replaying', async () => {
    const emitter = createEventEmitter();
    const events: unknown[] = [];
    emitter.subscribe((_type, payload) => events.push(payload));
    const state = createTestAgentState(directory, createTestAgentEvents(emitter), {
      repository,
      sessions,
    });
    await state[6].ensure(id);
    vi.spyOn(AgentQueueDeliveryStore.prototype, 'finish').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    const execute = vi.fn().mockRejectedValue(new Error('Provider failure'));
    await expect(state[8].process(id, execute)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: 'queue_error',
      error: expect.stringContaining('storage is unavailable'),
    });
    await restarted().recover(id);
    expect((await repository.loadQueue(id))[0].deliveryStatus).toBe('interrupted');
    expect(execute).toHaveBeenCalledTimes(1);
    await state[2].onApplicationShutdown();
  });

  it('rejects an inconsistent claimed record instead of treating it as already interrupted', async () => {
    const delivery = await store.claim(id, first);
    await writeFile(journal(), JSON.stringify({ ...delivery, disposition: 'interrupted' }));
    await expect(restarted().recover(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(await repository.loadQueue(id)).toEqual([first, later]);
  });

  it('persists delivery proof and drains multiple real AgentService follow-ups without duplicate execution', async () => {
    await repository.saveQueue(id, [
      { ...first, model: 'sonnet', providerId: undefined, imagePaths: undefined },
      { ...later, model: 'sonnet' },
    ]);
    const provider = new MockProvider('claude');
    const execute = vi.spyOn(provider, 'executeQuery');
    const registry = new ProviderRegistry([{ name: 'claude', create: () => provider }], {
      isDisconnected: () => false,
    } as never);
    const state = createTestAgentState(directory, createTestAgentEvents(createEventEmitter()), {
      repository,
      sessions,
    });
    const service = new AgentService(...state, undefined, ...createTestAgentProviders(registry));
    await service.initialize();
    try {
      expect(
        (await service.sendMessage({ sessionId: id, message: 'Manual trigger', model: 'sonnet' }))
          .success
      ).toBe(true);
      await vi.waitFor(async () => {
        expect(execute).toHaveBeenCalledTimes(3);
        expect(await repository.loadMessages(id)).toHaveLength(6);
        expect(await repository.loadQueue(id)).toEqual([]);
        expect(JSON.parse(await readFile(journal(), 'utf8')).phase).toBe('settled');
        expect(state[2].has(id)).toBe(false);
      });
      const delivered = (await repository.loadMessages(id)).filter((message) => message.deliveryId);
      expect(delivered.map((message) => message.queuedPromptId)).toEqual(['first', 'later']);
      expect(delivered.every((message) => message.deliveryStatus === 'completed')).toBe(true);
      expect(new Set(delivered.map((message) => message.deliveryId)).size).toBe(2);
      await restarted().recover(id);
      expect(await repository.loadQueue(id)).toEqual([]);
      expect(execute).toHaveBeenCalledTimes(3);
    } finally {
      await state[2].onApplicationShutdown();
    }
  });
});
