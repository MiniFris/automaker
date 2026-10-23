import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from '../../../src/services/agent-service.js';
import { AgentSessionRepository } from '../../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../../src/services/agent/agent-execution-coordinator.js';
import { AgentSessionStorageError } from '../../../src/services/agent/agent-session-storage.error.js';
import {
  ConflictDomainError,
  UnavailableDomainError,
} from '../../../src/core/errors/domain-errors.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import type { ExecuteOptions } from '../../../src/providers/types.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import { MockProvider } from '../../helpers/mock-provider.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('AgentService execution ownership', () => {
  let directory: string,
    repository: AgentSessionRepository,
    registry: AgentSessionRegistry,
    executions: AgentExecutionCoordinator,
    service: AgentService,
    sessionId: string;
  let mode: 'immediate' | 'gated', disposed: boolean, abortObserved: () => void;
  let started: ReturnType<typeof gate>,
    aborted: ReturnType<typeof gate>,
    cleanup: ReturnType<typeof gate>;
  let events: Array<{ type: string; content?: string }>;
  let pending: Promise<unknown>[];
  let execute: ReturnType<typeof vi.fn>;
  const send = () => {
    const task = service.sendMessage({ sessionId, message: 'Fixture request' });
    pending.push(task);
    void task.catch(() => undefined);
    return task;
  };
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-agent-lease-'));
    repository = new AgentSessionRepository(directory);
    registry = new AgentSessionRegistry();
    executions = new AgentExecutionCoordinator(1000);
    started = gate();
    aborted = gate();
    cleanup = gate();
    mode = 'gated';
    disposed = false;
    abortObserved = () => undefined;
    pending = [];
    events = [];
    const emitter = createEventEmitter();
    emitter.subscribe((type, payload) => {
      if (type === 'agent:stream') events.push(payload as (typeof events)[number]);
    });
    const provider = new MockProvider('claude');
    execute = vi.fn(async function* (options: ExecuteOptions) {
      if (mode === 'immediate') {
        yield {
          type: 'assistant' as const,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'Immediate reply' }],
          },
        };
        yield { type: 'result' as const, subtype: 'success' as const };
        return;
      }
      const waitForAbort = new Promise<void>((resolve) => {
        options.abortController!.signal.addEventListener(
          'abort',
          () => {
            abortObserved();
            resolve();
          },
          { once: true }
        );
      });
      try {
        yield {
          type: 'assistant' as const,
          session_id: 'fixture-sdk',
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'Partial reply' }],
          },
        };
        started.release();
        await waitForAbort;
        aborted.release();
        await cleanup.promise;
        yield {
          type: 'assistant' as const,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'LATE CHUNK' }],
          },
        };
        yield { type: 'result' as const, subtype: 'success' as const };
      } finally {
        disposed = true;
      }
    });
    provider.executeQuery = execute as typeof provider.executeQuery;
    service = new AgentService(
      repository,
      registry,
      executions,
      emitter,
      undefined,
      new ProviderRegistry([{ name: 'claude', create: () => provider }], {
        isDisconnected: () => false,
      } as never)
    );
    await service.initialize();
    sessionId = (await service.createSession('Lease fixture', directory, directory, 'sonnet')).id;
  });
  afterEach(async () => {
    cleanup.release();
    executions.stopAccepting();
    executions.abortAll();
    await Promise.allSettled(pending);
    await executions.onApplicationShutdown();
    await registry.onApplicationShutdown();
    await repository.drain();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('rejects a concurrent send while the first is still awaiting model preparation', async () => {
    mode = 'immediate';
    const preparing = gate(),
      release = gate();
    const update = repository.updateMetadata.bind(repository);
    vi.spyOn(repository, 'updateMetadata').mockImplementationOnce(async (...args) => {
      preparing.release();
      await release.promise;
      return update(...args);
    });
    const first = service.sendMessage({ sessionId, message: 'First', model: 'claude-sonnet-4-6' });
    pending.push(first);
    void first.catch(() => undefined);
    await preparing.promise;
    expect(() => send()).toThrow(ConflictDomainError);
    expect(execute).not.toHaveBeenCalled();
    release.release();
    expect((await first).success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('waits for provider cleanup on stop, fences late chunks and then permits a fresh run', async () => {
    const first = send();
    await started.promise;
    const stopping = service.stopExecution(sessionId);
    await aborted.promise;
    expect(disposed).toBe(false);
    expect(() => send()).toThrow(ConflictDomainError);
    cleanup.release();
    expect((await first).success).toBe(false);
    expect((await stopping).success).toBe(true);
    expect(disposed).toBe(true);
    expect(
      (await service.getHistory(sessionId)).messages?.some((message) =>
        message.content.includes('LATE')
      )
    ).toBe(false);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    mode = 'immediate';
    expect((await send()).success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each(['clear', 'delete'])(
    'drains the provider before %s so its finalizer cannot restore old history',
    async (action) => {
      const first = send();
      await started.promise;
      const changing =
        action === 'clear' ? service.clearSession(sessionId) : service.deleteSession(sessionId);
      await aborted.promise;
      expect(registry.get(sessionId)?.messages.length).toBeGreaterThan(0);
      expect(() => send()).toThrow(ConflictDomainError);
      cleanup.release();
      await Promise.all([first, changing]);
      expect(disposed).toBe(true);
      expect(await repository.loadMessages(sessionId)).toEqual([]);
      const metadata = (await repository.loadMetadata())[sessionId];
      if (action === 'clear') expect(metadata.sdkSessionId).toBeUndefined();
      else expect(metadata).toBeUndefined();
      expect(execute).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects both model mutation paths without aborting the active run', async () => {
    send();
    await started.promise;
    await expect(service.setSessionModel(sessionId, 'claude-opus')).rejects.toBeInstanceOf(
      ConflictDomainError
    );
    await expect(
      service.updateSessionDetails(sessionId, { model: 'claude-opus' })
    ).rejects.toBeInstanceOf(ConflictDomainError);
    expect(registry.get(sessionId)?.abortController?.signal.aborted).toBe(false);
    expect((await repository.loadMetadata())[sessionId].model).toBe('sonnet');
  });

  it('persists interruption before abort, drains cleanup and rejects replacement work during shutdown', async () => {
    const first = send();
    await started.promise;
    let committed = false,
      committedAtAbort = false;
    const save = repository.saveMessages.bind(repository);
    vi.spyOn(repository, 'saveMessages').mockImplementation(async (...args) => {
      await save(...args);
      if (args[1].some((message) => message.content === 'Interrupted: shutdown')) committed = true;
    });
    abortObserved = () => {
      committedAtAbort = committed;
    };
    const stopping = service.interruptActiveSessions('shutdown');
    await aborted.promise;
    expect(committedAtAbort).toBe(true);
    expect(disposed).toBe(false);
    expect(() => send()).toThrow(UnavailableDomainError);
    await expect(service.addToQueue(sessionId, { message: 'Too late' })).rejects.toBeInstanceOf(
      UnavailableDomainError
    );
    await expect(service.createSession('Too late', directory, directory)).rejects.toBeInstanceOf(
      UnavailableDomainError
    );
    cleanup.release();
    expect(await stopping).toBe(1);
    await first;
    expect(disposed).toBe(true);
    expect(
      (await repository.loadMessages(sessionId)).some(
        (message) => message.content === 'Interrupted: shutdown'
      )
    ).toBe(true);
  });

  it('still aborts and drains when the interruption write fails', async () => {
    const first = send();
    await started.promise;
    vi.spyOn(repository, 'saveMessages').mockRejectedValueOnce(
      new AgentSessionStorageError('write')
    );
    const stopping = service.interruptActiveSessions('shutdown');
    void stopping.catch(() => undefined);
    await aborted.promise;
    cleanup.release();
    await expect(stopping).rejects.toBeInstanceOf(AgentSessionStorageError);
    await first;
    expect(disposed).toBe(true);
    expect(executions.ids()).toEqual([]);
    expect(() => send()).toThrow(UnavailableDomainError);
  });
});
