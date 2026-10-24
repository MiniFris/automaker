import { AgentSessionRegistry } from './agent-session-registry.js';
import { AgentSessionRepository } from './agent-session.repository.js';
import { AgentSessionLoader } from './agent-session-loader.js';
import { AgentExecutionCoordinator } from './agent-execution-coordinator.js';
import { AgentEventPublisher } from './agent-event-publisher.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';
import type { AgentMessageInput, Message } from './agent-session.types.js';

export type AgentMessageExecution<T> = (
  input: AgentMessageInput,
  controller: AbortController
) => Promise<T>;

/** Conversation admission/cancellation; provider execution is an explicit application callback. */
export class AgentConversationCoordinator {
  constructor(
    private readonly executions: AgentExecutionCoordinator,
    private readonly sessions: AgentSessionRegistry,
    private readonly loader: AgentSessionLoader,
    private readonly repository: AgentSessionRepository,
    private readonly events: AgentEventPublisher
  ) {}

  run<T>(
    id: string,
    select: (controller: AbortController) => Promise<AgentMessageInput | undefined>,
    execute: AgentMessageExecution<T>
  ) {
    return this.executions.run(id, async (controller) => {
      try {
        const input = await select(controller);
        if (!input) return { success: false as const };
        controller.signal.throwIfAborted();
        return await execute(input, controller);
      } catch (error) {
        if (controller.signal.aborted && !(error instanceof AgentSessionStorageError))
          return { success: false as const, aborted: true as const };
        throw error;
      } finally {
        const session = this.sessions.get(id);
        if (session?.abortController === controller) {
          session.isRunning = false;
          session.abortController = null;
        }
      }
    });
  }

  stop(id: string) {
    return this.executions.mutate(id, async () => {
      const session = await this.loader.ensure(id);
      if (!session) return { success: false, error: 'Session not found' };
      session.abortController?.abort();
      session.isRunning = false;
      session.abortController = null;
      return { success: true };
    });
  }

  clear(id: string) {
    return this.executions.mutate(id, () =>
      this.sessions.serializeQueue(id, async () => {
        const session = await this.loader.ensure(id);
        if (session) await this.save(id, []);
        await this.repository.clearSdkSessionId(id);
        if (session) {
          session.messages = [];
          session.isRunning = false;
          session.sdkSessionId = undefined;
        }
        return { success: true };
      })
    );
  }

  async interrupt(reason: string): Promise<number> {
    this.executions.stopAccepting();
    const ids = new Set([
      ...this.executions.ids(),
      ...[...this.sessions.entries()].filter(([, session]) => session.isRunning).map(([id]) => id),
    ]);
    let interrupted = 0;
    const results = await Promise.allSettled(
      [...ids].map(async (id) => {
        const session = await this.loader.ensure(id);
        if (!session) return;
        const managed = this.executions.has(id);
        if (!managed && !session.isRunning) return;
        const message: Message = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          role: 'assistant',
          content: `Interrupted: ${reason}`,
          timestamp: new Date().toISOString(),
          isError: true,
        };
        session.messages.push(message);
        await this.save(id, session.messages);
        if (managed && !this.executions.has(id)) {
          session.messages = session.messages.filter((item) => item.id !== message.id);
          await this.save(id, session.messages);
          return;
        }
        interrupted++;
        this.events.publish(id, {
          type: 'error',
          error: reason,
          errorType: 'interruption',
          message,
        });
      })
    );
    // Persistence failure must never skip abort/drain of owned executions.
    this.executions.abortAll();
    for (const id of ids) this.sessions.get(id)?.abortController?.abort();
    await this.executions.drain();
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session) {
        session.isRunning = false;
        session.abortController = null;
      }
    }
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return interrupted;
  }

  private async save(id: string, messages: Message[]) {
    await this.repository.saveMessages(id, messages);
    await this.repository.touchMetadata(id);
  }
}
