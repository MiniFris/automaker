import { ApplicationMetrics } from '../../../src/core/observability/application-metrics.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { MockProvider } from '../../helpers/mock-provider.js';
import {
  createTestAgentState,
  createTestAgentEvents,
  createTestAgentProviders,
} from '../../helpers/agent-state.js';
import { AgentService } from '../../../src/services/agent-service.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { ProviderCleanupError } from '../../../src/providers/provider-execution-scope.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import type { ExecuteOptions, ProviderMessage } from '../../../src/providers/types.js';

it.each([false, true])(
  'never consumes a queued request when cleanup is unconfirmed (parent cancelled=%s)',
  async (cancelParent) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-provider-cleanup-'));
    const calls: string[] = [];
    let cancel: (() => void) | undefined;
    class BrokenProvider extends MockProvider {
      protected execute(input: ExecuteOptions): AsyncGenerator<ProviderMessage> {
        calls.push(String(input.prompt));
        if (input.prompt === 'Unknown queued outcome') {
          return {
            next: async () => ({
              done: false,
              value: { type: 'error', error: 'Upstream failure' },
            }),
            return: async () => {
              if (cancelParent) cancel?.();
              throw new Error('private cleanup detail');
            },
            throw: async () => ({ done: true, value: undefined }),
            [Symbol.asyncIterator]() {
              return this;
            },
          };
        }
        return super.execute(input);
      }
    }
    const providers = new ProviderRegistry(
      [{ name: 'claude', create: () => new BrokenProvider('claude') }],
      { isDisconnected: () => false } as never,
      new ApplicationMetrics()
    );
    const events: Array<{ type: string; errorType?: string; error?: string }> = [];
    const emitter = createEventEmitter();
    emitter.subscribe((type, payload) => {
      if (type === 'agent:stream') events.push(payload as (typeof events)[number]);
    });
    const state = createTestAgentState(directory, createTestAgentEvents(emitter));
    const service = new AgentService(...state, undefined, ...createTestAgentProviders(providers));
    try {
      await service.initialize();
      const session = await service.createSession('Fixture', directory, directory, 'sonnet');
      cancel = () => state[1].get(session.id)?.abortController?.abort();
      await service.startConversation({ sessionId: session.id });
      await service.addToQueue(session.id, { message: 'Unknown queued outcome', model: 'sonnet' });
      await service.sendMessage({ sessionId: session.id, message: 'Manual trigger' });
      await vi.waitFor(() =>
        expect(events.some((event) => event.errorType === 'execution_cleanup')).toBe(true)
      );
      await vi.waitFor(() => expect(state[2].has(session.id)).toBe(false));
      expect(calls).toEqual(['Manual trigger', 'Unknown queued outcome']);
      expect(JSON.stringify(events)).not.toContain('private cleanup detail');
      const journal = JSON.parse(
        await readFile(path.join(directory, 'agent-queue-deliveries', `${session.id}.json`), 'utf8')
      );
      expect(journal.phase).toBe('claimed');
      expect((await state[0].loadMessages(session.id)).at(-1)).toMatchObject({
        role: 'user',
        content: 'Unknown queued outcome',
      });
      expect((await state[0].loadMessages(session.id)).at(-1)?.deliveryStatus).toBeUndefined();
      expect(
        JSON.parse(
          await readFile(path.join(directory, 'agent-executions', `${session.id}.json`), 'utf8')
        ).phase
      ).toBe('running');
      const history = await service.getHistory(session.id);
      expect(history.messages?.at(-1)?.content).toContain('No automatic replay');
      expect((await service.getQueue(session.id)).queue?.[0].deliveryStatus).toBe('interrupted');
      await expect(
        service.sendMessage({ sessionId: session.id, message: 'No replacement' })
      ).rejects.toThrow('not accepting');
      expect(calls).toHaveLength(2);
      await expect(providers.onApplicationShutdown()).rejects.toBeInstanceOf(ProviderCleanupError);
    } finally {
      await state[2].onApplicationShutdown();
      await state[0].drain();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
