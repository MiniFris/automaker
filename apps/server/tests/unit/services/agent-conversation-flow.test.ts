import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentSessionLoader } from '../../../src/services/agent/agent-session-loader.js';
import { AgentConversationCoordinator } from '../../../src/services/agent/agent-conversation-coordinator.js';
import { AgentPromptQueue } from '../../../src/services/agent/agent-prompt-queue.js';
import { AgentExecutionCoordinator } from '../../../src/services/agent/agent-execution-coordinator.js';
import { AgentEventPublisher } from '../../../src/services/agent/agent-event-publisher.js';
import { AgentQueueDeliveryStore } from '../../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import {
  ConflictDomainError,
  UnavailableDomainError,
} from '../../../src/core/errors/domain-errors.js';
import { createEventEmitter } from '../../../src/lib/events.js';

describe('conversation/queue application components', () => {
  const id = 'flow-session';
  let directory: string,
    repository: AgentSessionRepository,
    sessions: AgentSessionRegistry,
    executions: AgentExecutionCoordinator,
    loader: AgentSessionLoader,
    conversations: AgentConversationCoordinator,
    queue: AgentPromptQueue;
  let events: Array<Record<string, unknown>>;
  let releases: Array<() => void>;
  let pending: Promise<unknown>[];
  const track = <T>(task: Promise<T>) => {
    pending.push(task);
    void task.catch(() => undefined);
    return task;
  };
  const gate = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.push(release);
    return { promise, release };
  };
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-conversation-flow-'));
    events = [];
    releases = [];
    pending = [];
    repository = new AgentSessionRepository(directory);
    sessions = new AgentSessionRegistry();
    executions = new AgentExecutionCoordinator(1000);
    const deliveries = new AgentQueueDeliveryStore(directory, repository, sessions);
    loader = new AgentSessionLoader(repository, sessions, directory, deliveries);
    const emitter = createEventEmitter();
    emitter.subscribe((type, payload) => {
      if (type === 'agent:stream') events.push(payload as Record<string, unknown>);
    });
    const publisher = new AgentEventPublisher(emitter);
    conversations = new AgentConversationCoordinator(
      executions,
      sessions,
      loader,
      repository,
      publisher
    );
    queue = new AgentPromptQueue(
      repository,
      sessions,
      loader,
      executions,
      conversations,
      publisher,
      deliveries
    );
    await repository.initialize();
    await repository.addMetadata({
      id,
      name: 'Fixture',
      workingDirectory: directory,
      createdAt: 'now',
      updatedAt: 'now',
      model: 'sonnet',
      providerId: 'endpoint',
      sdkSessionId: 'saved-sdk',
    });
  });
  afterEach(async () => {
    releases.forEach((release) => release());
    executions.stopAccepting();
    executions.abortAll();
    await Promise.allSettled(pending);
    await executions.onApplicationShutdown();
    await sessions.onApplicationShutdown();
    await repository.drain();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('coalesces hydration and preserves persisted SDK identity and queue across state-owner restart', async () => {
    await repository.saveQueue(id, [
      {
        id: 'queued',
        message: 'Continue',
        model: 'sonnet',
        providerId: 'endpoint',
        addedAt: 'now',
      },
    ]);
    const read = vi.spyOn(repository, 'loadMetadata');
    const [first, second] = await Promise.all([loader.ensure(id), loader.ensure(id)]);
    expect(first).toBe(second);
    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      sdkSessionId: 'saved-sdk',
      isRunning: false,
      promptQueue: [{ id: 'queued' }],
    });
    const restartedSessions = new AgentSessionRegistry();
    const restarted = await new AgentSessionLoader(
      repository,
      restartedSessions,
      directory,
      new AgentQueueDeliveryStore(directory, repository, restartedSessions)
    ).ensure(id);
    expect(restarted?.sdkSessionId).toBe('saved-sdk');
    expect(restarted?.promptQueue).toEqual(first?.promptQueue);
    expect(restarted).not.toBe(first);
    expect(events).toEqual([]);
  });
  it('uses the injected application directory for legacy records without a directory', async () => {
    await repository.updateMetadata(id, { workingDirectory: '' });
    expect((await loader.ensure(id))?.workingDirectory).toBe(directory);
    expect(directory).not.toBe(process.cwd());
  });
  it('propagates storage errors without creating a blank active session', async () => {
    vi.spyOn(repository, 'loadMetadata').mockRejectedValueOnce(
      new AgentSessionStorageError('read')
    );
    await expect(loader.ensure(id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(sessions.size).toBe(0);
    expect(await loader.ensure('absent-session')).toBeNull();
  });
  it('claims admission before input selection and rejects a second run synchronously', async () => {
    const entered = gate(),
      selected = gate();
    const execute = vi.fn().mockResolvedValue({ success: true });
    const running = track(
      conversations.run(
        id,
        async () => {
          entered.release();
          await selected.promise;
          return { sessionId: id, message: 'Request' };
        },
        execute
      )
    );
    await entered.promise;
    expect(() => conversations.run(id, async () => undefined, execute)).toThrow(
      ConflictDomainError
    );
    expect(execute).not.toHaveBeenCalled();
    selected.release();
    expect(await running).toEqual({ success: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('cancels delayed selection without starting the provider or clearing the saved SDK ID', async () => {
    const entered = gate(),
      selected = gate();
    const execute = vi.fn();
    const running = track(
      conversations.run(
        id,
        async () => {
          entered.release();
          await selected.promise;
          return { sessionId: id, message: 'Never execute' };
        },
        execute
      )
    );
    await entered.promise;
    const stopping = track(conversations.stop(id));
    await Promise.resolve();
    selected.release();
    expect(await running).toMatchObject({ success: false, aborted: true });
    expect(await stopping).toEqual({ success: true });
    expect(execute).not.toHaveBeenCalled();
    expect((await repository.loadMetadata())[id].sdkSessionId).toBe('saved-sdk');
  });
  it('keeps the lease through delayed cleanup and resets active flags only for the owning controller', async () => {
    const entered = gate(),
      aborted = gate(),
      cleanup = gate();
    const session = (await loader.ensure(id))!;
    const running = track(
      conversations.run(
        id,
        async () => ({ sessionId: id, message: 'Run' }),
        async (_input, controller) => {
          session.isRunning = true;
          session.abortController = controller;
          const cancellation = new Promise<void>((resolve) =>
            controller.signal.addEventListener(
              'abort',
              () => {
                aborted.release();
                resolve();
              },
              { once: true }
            )
          );
          entered.release();
          await cancellation;
          await cleanup.promise;
          return { success: false };
        }
      )
    );
    await entered.promise;
    let stopped = false;
    const stopping = track(
      conversations.stop(id).then((value) => {
        stopped = true;
        return value;
      })
    );
    await aborted.promise;
    expect(stopped).toBe(false);
    expect(() => conversations.run(id, async () => undefined, vi.fn())).toThrow(
      ConflictDomainError
    );
    cleanup.release();
    await running;
    await stopping;
    expect(session.isRunning).toBe(false);
    expect(session.abortController).toBeNull();
  });
  it('never masks a storage error as successful cancellation', async () => {
    const running = track(
      conversations.run(
        id,
        async () => ({ sessionId: id, message: 'Run' }),
        async (_input, controller) => {
          controller.abort();
          throw new AgentSessionStorageError('write');
        }
      )
    );
    await expect(running).rejects.toBeInstanceOf(AgentSessionStorageError);
  });
  it('clears persisted messages and SDK resume identity but preserves queued follow-ups', async () => {
    await repository.saveMessages(id, [
      { id: 'old', role: 'assistant', content: 'Old answer', timestamp: 'now' },
    ]);
    await queue.add(id, { message: 'Keep queued' });
    expect(await conversations.clear(id)).toEqual({ success: true });
    expect((await loader.ensure(id))?.messages).toEqual([]);
    expect((await repository.loadMetadata())[id].sdkSessionId).toBeUndefined();
    expect(await repository.loadMessages(id)).toEqual([]);
    expect(await repository.loadQueue(id)).toHaveLength(1);
  });
  it.each([
    [{ message: 'Default' }, 'sonnet', 'endpoint'],
    [{ message: 'Same model', model: 'sonnet' }, 'sonnet', 'endpoint'],
    [{ message: 'Different model', model: 'codex-auto' }, 'codex-auto', undefined],
    [
      { message: 'Explicit', model: 'other', providerId: 'other-endpoint' },
      'other',
      'other-endpoint',
    ],
  ])('pins queued model/provider identity: %j', async (input, model, providerId) => {
    const result = await queue.add(id, input);
    expect(result.queuedPrompt).toMatchObject({ model });
    expect(result.queuedPrompt?.providerId).toBe(providerId);
    expect((await repository.loadQueue(id))[0]).toEqual(result.queuedPrompt);
  });
  it('serializes concurrent queue writes and publishes only committed mutations', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => queue.add(id, { message: `Request ${index}` }))
    );
    const before = (await queue.get(id)).queue!;
    expect(before).toHaveLength(8);
    expect(await repository.loadQueue(id)).toEqual(before);
    vi.spyOn(repository, 'saveQueue').mockRejectedValueOnce(new AgentSessionStorageError('write'));
    await expect(queue.remove(id, before[0].id)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect((await queue.get(id)).queue).toEqual(before);
    expect(events).toHaveLength(8);
    await queue.clear(id);
    expect(await repository.loadQueue(id)).toEqual([]);
  });
  it('owns admission before dequeue and passes the pinned selection to execution', async () => {
    const added = await queue.add(id, { message: 'Queued request' });
    events = [];
    const execute = vi.fn(async (input) => {
      expect(input).toMatchObject({
        sessionId: id,
        message: 'Queued request',
        model: 'sonnet',
        providerId: 'endpoint',
      });
      expect(executions.has(id)).toBe(true);
      expect(await repository.loadQueue(id)).toEqual([]);
      expect(() => conversations.run(id, async () => undefined, vi.fn())).toThrow(
        ConflictDomainError
      );
      return { success: true };
    });
    await queue.process(id, execute);
    expect(added.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['queue_updated']);
  });
  it('does not dequeue or error an existing run when admission is busy', async () => {
    await queue.add(id, { message: 'Retain queued' });
    const release = gate(),
      entered = gate();
    const running = track(
      conversations.run(
        id,
        async () => ({ sessionId: id, message: 'Manual' }),
        async () => {
          entered.release();
          await release.promise;
          return { success: true };
        }
      )
    );
    await entered.promise;
    events = [];
    const execute = vi.fn();
    await queue.process(id, execute);
    expect(execute).not.toHaveBeenCalled();
    expect(await repository.loadQueue(id)).toHaveLength(1);
    expect(events).toEqual([]);
    release.release();
    await running;
  });
  it('does not execute or remove a queued prompt after dequeue persistence fails', async () => {
    await queue.add(id, { message: 'Retain queued' });
    events = [];
    vi.spyOn(repository, 'saveQueue').mockRejectedValueOnce(new AgentSessionStorageError('write'));
    const execute = vi.fn();
    await queue.process(id, execute);
    expect(execute).not.toHaveBeenCalled();
    expect((await queue.get(id)).queue).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(['queue_error']);
    expect(executions.has(id)).toBe(false);
  });
  it('rechecks shutdown after asynchronous hydration before committing queue changes', async () => {
    const read = repository.loadMetadata.bind(repository);
    vi.spyOn(repository, 'loadMetadata').mockImplementationOnce(async () => {
      executions.stopAccepting();
      return read();
    });
    await expect(queue.add(id, { message: 'Not admitted' })).rejects.toBeInstanceOf(
      UnavailableDomainError
    );
    expect(await repository.loadQueue(id)).toEqual([]);
    expect(events).toEqual([]);
  });
});
