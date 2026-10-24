import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from '../../../src/services/agent-service.js';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../../src/services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../../src/services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../../src/services/agent/agent-environment-preparer.js';
import { createTestAgentProviders, createTestAgentEvents } from '../../helpers/agent-state.js';
import { AgentStreamNormalizer } from '../../../src/services/agent/agent-stream-normalizer.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import { MockProvider } from '../../helpers/mock-provider.js';

describe('agent storage failure boundaries', () => {
  let directory: string,
    repository: AgentSessionRepository,
    registry: AgentSessionRegistry,
    service: AgentService,
    sessionId: string;
  let events: Array<{ type: string; errorType?: string }>;
  let execute: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'agent-storage-failure-'));
    repository = new AgentSessionRepository(directory);
    registry = new AgentSessionRegistry();
    const emitter = createEventEmitter();
    events = [];
    emitter.subscribe((type, payload) => {
      if (type === 'agent:stream') events.push(payload as (typeof events)[number]);
    });
    service = new AgentService(
      repository,
      registry,
      new AgentExecutionCoordinator(),
      new AgentPromptBuilder(),
      new AgentEnvironmentPreparer(new AgentPromptBuilder()),
      new AgentStreamNormalizer(),
      createTestAgentEvents(emitter),
      undefined,
      ...createTestAgentProviders(
        new ProviderRegistry([{ name: 'claude', create: () => new MockProvider('claude') }], {
          isDisconnected: () => false,
        } as never)
      )
    );
    execute = vi.spyOn(MockProvider.prototype, 'executeQuery');
    await service.initialize();
    sessionId = (await service.createSession('Fixture', directory, directory, 'sonnet')).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await registry.onApplicationShutdown();
    await repository.drain();
    await rm(directory, { recursive: true, force: true });
  });

  it('does not create a blank active session after a repository read error', async () => {
    vi.spyOn(repository, 'loadMetadata').mockRejectedValueOnce(
      new AgentSessionStorageError('read')
    );
    await expect(service.startConversation({ sessionId })).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    expect(registry.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not execute the provider when the initial user message cannot be persisted', async () => {
    vi.spyOn(repository, 'saveMessages').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(
      service.sendMessage({ sessionId, message: 'Do not execute' })
    ).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(execute).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', errorType: 'persistence' });
    expect((await service.getHistory(sessionId)).isRunning).toBe(false);
    expect((await service.getHistory(sessionId)).messages).toEqual([]);
    expect(await repository.loadMessages(sessionId)).toEqual([]);
  });

  it('does not emit completion or retry the model after a final save fails', async () => {
    const save = repository.saveMessages.bind(repository);
    vi.spyOn(repository, 'saveMessages')
      .mockImplementationOnce(save)
      .mockRejectedValueOnce(new AgentSessionStorageError('write'));
    await expect(service.sendMessage({ sessionId, message: 'Once only' })).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', errorType: 'persistence' });
    expect((await service.getHistory(sessionId)).isRunning).toBe(false);
    expect(await repository.loadMessages(sessionId)).toHaveLength(1);
  });

  it('emits complete only after the final durable write resolves', async () => {
    const save = repository.saveMessages.bind(repository);
    let release!: () => void;
    vi.spyOn(repository, 'saveMessages')
      .mockImplementationOnce(save)
      .mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await save(...args);
      });
    const sending = service.sendMessage({ sessionId, message: 'Await durable completion' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    release();
    expect((await sending).success).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
    expect(await repository.loadMessages(sessionId)).toHaveLength(2);
  });

  it('persists result-only answers with stable stream/completion IDs', async () => {
    execute.mockImplementationOnce(async function* () {
      yield { type: 'result' as const, subtype: 'success' as const, result: 'Buffered reply' };
    });
    const result = await service.sendMessage({ sessionId, message: 'Buffered request' });
    expect(result.success).toBe(true);
    if (!('message' in result) || !result.message) throw new Error('Missing buffered answer');
    expect(result.message).toMatchObject({ role: 'assistant', content: 'Buffered reply' });
    expect(events.map((event) => event.type)).toEqual(['started', 'message', 'stream', 'complete']);
    expect(events[2]).toMatchObject({ messageId: result.message!.id, content: 'Buffered reply' });
    expect(events[3]).toMatchObject({ messageId: result.message!.id, content: 'Buffered reply' });
    expect((await repository.loadMessages(sessionId))[1]).toEqual(result.message);
  });

  it('does not mutate the active SDK ID or publish a chunk when its metadata write fails', async () => {
    let closed = false;
    execute.mockImplementationOnce(async function* () {
      try {
        yield {
          type: 'assistant' as const,
          session_id: 'uncommitted-sdk',
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'Must not stream' }],
          },
        };
      } finally {
        closed = true;
      }
    });
    const update = repository.updateMetadata.bind(repository);
    vi.spyOn(repository, 'updateMetadata').mockImplementation(async (id, updates) => {
      if (updates.sdkSessionId) throw new AgentSessionStorageError('write');
      return update(id, updates);
    });
    await expect(service.sendMessage({ sessionId, message: 'SDK request' })).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    expect(closed).toBe(true);
    expect(registry.get(sessionId)?.sdkSessionId).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(['started', 'message', 'error']);
    expect(await repository.loadMessages(sessionId)).toHaveLength(1);
  });

  it('waits for provider iterator cleanup before durable completion and publication', async () => {
    let release!: () => void, entered!: () => void;
    const cleaning = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    execute.mockImplementationOnce(async function* () {
      try {
        yield { type: 'result' as const, subtype: 'success' as const, result: 'Buffered reply' };
      } finally {
        entered();
        await cleanup;
      }
    });
    const sending = service.sendMessage({ sessionId, message: 'Wait for cleanup' });
    try {
      await cleaning;
      expect(events.some((event) => event.type === 'complete')).toBe(false);
      expect(await repository.loadMessages(sessionId)).toHaveLength(1);
    } finally {
      release();
    }
    expect((await sending).success).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
    expect(await repository.loadMessages(sessionId)).toHaveLength(2);
  });

  it('serializes queue mutations and never publishes a failed add/remove/clear', async () => {
    await service.startConversation({ sessionId });
    const save = vi.spyOn(repository, 'saveQueue');
    save.mockRejectedValueOnce(new AgentSessionStorageError('write'));
    await expect(service.addToQueue(sessionId, { message: 'Failed add' })).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    expect((await service.getQueue(sessionId)).queue).toEqual([]);
    expect(events).toEqual([]);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        service.addToQueue(sessionId, { message: `Queued ${index}` })
      )
    );
    const queue = (await service.getQueue(sessionId)).queue!;
    expect(queue).toHaveLength(8);
    expect(await repository.loadQueue(sessionId)).toHaveLength(8);
    save.mockRejectedValueOnce(new AgentSessionStorageError('write'));
    await expect(service.removeFromQueue(sessionId, queue[0].id)).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    save.mockRejectedValueOnce(new AgentSessionStorageError('write'));
    await expect(service.clearQueue(sessionId)).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect((await service.getQueue(sessionId)).queue).toHaveLength(8);
    expect(events.filter((event) => event.type === 'queue_updated')).toHaveLength(8);
    await service.clearQueue(sessionId);
    expect(await repository.loadQueue(sessionId)).toEqual([]);
  });

  it('clears persisted history even before the session has been activated', async () => {
    await repository.saveMessages(sessionId, [
      {
        id: 'previous',
        role: 'user',
        content: 'Previous history',
        timestamp: new Date().toISOString(),
      },
    ]);
    expect(registry.size).toBe(0);
    await service.clearSession(sessionId);
    expect(await repository.loadMessages(sessionId)).toEqual([]);
    expect((await service.getHistory(sessionId)).messages).toEqual([]);
  });

  it('does not change the active model before metadata persistence succeeds', async () => {
    await service.startConversation({ sessionId });
    vi.spyOn(repository, 'updateMetadata').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(service.setSessionModel(sessionId, 'claude-opus')).rejects.toBeInstanceOf(
      AgentSessionStorageError
    );
    expect(registry.get(sessionId)?.model).toBe('sonnet');
    expect((await repository.loadMetadata())[sessionId].model).toBe('sonnet');
    vi.mocked(repository.updateMetadata).mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    await expect(
      service.sendMessage({ sessionId, message: 'Failed preparation', model: 'claude-opus' })
    ).rejects.toBeInstanceOf(AgentSessionStorageError);
    expect(registry.get(sessionId)?.model).toBe('sonnet');
    expect(execute).not.toHaveBeenCalled();
  });
});
