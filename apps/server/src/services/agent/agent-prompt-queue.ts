import { createLogger } from '@automaker/utils';
import { ConflictDomainError, UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { AgentSessionRepository } from './agent-session.repository.js';
import { AgentSessionRegistry } from './agent-session-registry.js';
import { AgentSessionLoader } from './agent-session-loader.js';
import { AgentExecutionCoordinator } from './agent-execution-coordinator.js';
import {
  AgentConversationCoordinator,
  type AgentMessageExecution,
} from './agent-conversation-coordinator.js';
import { AgentEventPublisher } from './agent-event-publisher.js';
import type { QueuedPrompt } from './agent-session.types.js';
import { AgentQueueDeliveryStore, type AgentQueueDelivery } from './agent-queue-delivery-store.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';

export type AgentQueuedInput = Pick<
  QueuedPrompt,
  'message' | 'imagePaths' | 'model' | 'providerId' | 'thinkingLevel'
>;

function succeeded(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'success' in result && result.success === true;
}

/** Serializes durable follow-up mutations and reserves execution before dequeueing. */
export class AgentPromptQueue {
  private readonly logger = createLogger('AgentPromptQueue');
  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry,
    private readonly loader: AgentSessionLoader,
    private readonly executions: AgentExecutionCoordinator,
    private readonly conversations: AgentConversationCoordinator,
    private readonly events: AgentEventPublisher,
    private readonly deliveries: AgentQueueDeliveryStore
  ) {}

  async add(
    id: string,
    input: AgentQueuedInput
  ): Promise<{ success: boolean; queuedPrompt?: QueuedPrompt; error?: string }> {
    this.executions.assertSessionOpen(id);
    return this.sessions.serializeQueue(id, async () => {
      this.executions.assertSessionOpen(id);
      await this.deliveries.recover(id);
      const session = await this.loader.ensure(id);
      this.executions.assertSessionOpen(id);
      if (!session) return { success: false, error: 'Session not found' };
      const prompt: QueuedPrompt = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        message: input.message,
        imagePaths: input.imagePaths,
        model: input.model ?? session.model,
        providerId:
          input.providerId ??
          (input.model === undefined || input.model === session.model
            ? session.providerId
            : undefined),
        thinkingLevel: input.thinkingLevel,
        addedAt: new Date().toISOString(),
      };
      const queue = [...session.promptQueue, prompt];
      await this.repository.saveQueue(id, queue);
      session.promptQueue = queue;
      this.events.publish(id, { type: 'queue_updated', queue });
      return { success: true, queuedPrompt: prompt };
    });
  }

  async get(id: string): Promise<{ success: boolean; queue?: QueuedPrompt[]; error?: string }> {
    return this.sessions.serializeQueue(id, async () => {
      await this.deliveries.recover(id);
      const session = await this.loader.ensure(id);
      return session
        ? { success: true, queue: session.promptQueue }
        : { success: false, error: 'Session not found' };
    });
  }

  async remove(id: string, promptId: string) {
    return this.mutate(id, (queue) => {
      const index = queue.findIndex((prompt) => prompt.id === promptId);
      return index < 0 ? undefined : queue.filter((_, position) => position !== index);
    });
  }
  async clear(id: string) {
    return this.mutate(id, () => []);
  }

  private mutate(id: string, change: (queue: QueuedPrompt[]) => QueuedPrompt[] | undefined) {
    this.executions.assertSessionOpen(id);
    return this.sessions.serializeQueue(id, async () => {
      this.executions.assertSessionOpen(id);
      await this.deliveries.recover(id);
      const session = await this.loader.ensure(id);
      this.executions.assertSessionOpen(id);
      if (!session) return { success: false, error: 'Session not found' };
      const queue = change(session.promptQueue);
      if (!queue) return { success: false, error: 'Prompt not found in queue' };
      await this.repository.saveQueue(id, queue);
      session.promptQueue = queue;
      this.events.publish(id, { type: 'queue_updated', queue });
      return { success: true };
    });
  }

  async process<T>(id: string, execute: AgentMessageExecution<T>): Promise<void> {
    let next: QueuedPrompt | undefined;
    let admitted = false;
    let delivery: AgentQueueDelivery | undefined;
    try {
      const execution = this.conversations.run(
        id,
        async (controller) => {
          next = await this.sessions.serializeQueue(id, async () => {
            await this.deliveries.recover(id);
            if (this.deliveries.isOwned(id)) return undefined;
            const session = this.sessions.get(id);
            if (!session || session.isRunning || !session.promptQueue.length) return undefined;
            controller.signal.throwIfAborted();
            const [first, ...remaining] = session.promptQueue;
            if (first.deliveryStatus === 'interrupted') return undefined;
            delivery = await this.deliveries.claim(id, first);
            await this.repository.saveQueue(id, remaining);
            session.promptQueue = remaining;
            this.events.publish(id, { type: 'queue_updated', queue: remaining });
            return first;
          });
          return next
            ? {
                sessionId: id,
                message: next.message,
                imagePaths: next.imagePaths,
                model: next.model,
                providerId: next.providerId,
                thinkingLevel: next.thinkingLevel,
              }
            : undefined;
        },
        (input, controller) => execute(input, controller, delivery?.deliveryId, delivery?.prompt.id)
      );
      admitted = true;
      const result = await execution;
      if (await this.repository.deletionState(id)) return;
      if (delivery) await this.deliveries.finish(delivery);
      if (succeeded(result)) setImmediate(() => void this.process(id, execute));
    } catch (error) {
      let reportedError = error;
      try {
        if (await this.repository.deletionState(id)) return;
      } catch (deletionError) {
        reportedError = deletionError;
      }
      if (
        !admitted &&
        (error instanceof ConflictDomainError || error instanceof UnavailableDomainError)
      )
        return;
      if (delivery && !(error instanceof AgentSessionStorageError)) {
        try {
          await this.deliveries.finish(delivery);
        } catch (settlementError) {
          reportedError = settlementError;
        }
      }
      this.logger.error('Failed to process queued prompt:', reportedError);
      this.events.publish(id, {
        type: 'queue_error',
        error:
          reportedError instanceof Error
            ? reportedError.message
            : 'Queued prompt execution failed.',
        promptId: next?.id,
      });
    } finally {
      if (delivery) this.deliveries.release(delivery);
    }
  }
}
