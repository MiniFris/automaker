import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson } from '@automaker/utils';
import * as secureFs from '../../lib/secure-fs.js';
import type { AgentStorageFilesystem } from './agent-storage-filesystem.js';
import { ConflictDomainError } from '../../core/errors/domain-errors.js';
import { assertCanonicalAgentSessionId } from './agent-session-id.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';
import { AgentSessionRepository } from './agent-session.repository.js';
import { AgentSessionRegistry } from './agent-session-registry.js';
import { removeAgentStorageArtifacts } from './agent-storage-artifacts.js';
import type { Message } from './agent-session.types.js';
import { AgentQueueDeliveryStore } from './agent-queue-delivery-store.js';

export type AgentExecutionStatus = 'completed' | 'failed' | 'cancelled';
export interface AgentExecutionRecord {
  version: 1;
  sessionId: string;
  runId: string;
  createdAt: string;
  phase: 'running' | 'completing' | 'settled';
  status?: AgentExecutionStatus | 'interrupted';
  userMessage?: Message;
  messages?: Message[];
  sdkSessionId?: string;
}
const terminal = (value: unknown): value is AgentExecutionStatus =>
  ['completed', 'failed', 'cancelled'].includes(String(value));
const message = (value: unknown): value is Message => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Message;
  return (
    typeof item.id === 'string' &&
    ['user', 'assistant'].includes(item.role) &&
    typeof item.content === 'string' &&
    typeof item.timestamp === 'string'
  );
};

/** One controller per DATA_DIR. Unknown effects are reported, never replayed. */
export class AgentExecutionStore {
  private readonly directory: string;
  private readonly owners = new Map<string, string>();
  private readonly writes = new Map<string, Promise<unknown>>();
  constructor(
    dataDirectory: string,
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry,
    private readonly deliveries: AgentQueueDeliveryStore,
    private readonly filesystem: AgentStorageFilesystem = secureFs
  ) {
    this.directory = path.join(dataDirectory, 'agent-executions');
  }

  begin(id: string, userMessage: Message): Promise<AgentExecutionRecord> {
    assertCanonicalAgentSessionId(id);
    const snapshot = globalThis.structuredClone(userMessage);
    return this.serialize(id, async () => {
      await this.repository.assertAvailable(id);
      const previous = await this.read(id);
      if (this.owners.has(id) || (previous && previous.phase !== 'settled'))
        throw new ConflictDomainError(
          'Recover the previous agent execution before starting another.'
        );
      const runId = randomUUID();
      const record: AgentExecutionRecord = {
        version: 1,
        sessionId: id,
        runId,
        createdAt: new Date().toISOString(),
        phase: 'running',
        userMessage: { ...snapshot, runId },
      };
      this.owners.set(id, runId);
      try {
        await this.write(record);
      } catch (error) {
        this.owners.delete(id);
        throw error;
      }
      return record;
    });
  }

  complete(
    run: AgentExecutionRecord,
    messages: Message[],
    status: AgentExecutionStatus,
    sdkSessionId?: string
  ): Promise<void> {
    const snapshot = globalThis.structuredClone(messages);
    return this.serialize(run.sessionId, async () => {
      if (this.owners.get(run.sessionId) !== run.runId)
        throw new ConflictDomainError('Agent execution ownership has changed.');
      const user = snapshot.find((item) => item.role === 'user' && item.runId === run.runId);
      if (!user) throw new AgentSessionStorageError('write');
      user.executionStatus = status;
      const intent: AgentExecutionRecord = {
        ...run,
        phase: 'completing',
        status,
        messages: snapshot,
        sdkSessionId,
      };
      // Terminal intent follows iterator cleanup and precedes history acknowledgement.
      await this.write(intent);
      await this.repository.saveMessages(run.sessionId, snapshot);
      await this.repository.touchMetadata(run.sessionId);
      await this.consumeDelivery(run.sessionId, user);
      await this.write(this.settled(intent, status));
    });
  }

  release(run: AgentExecutionRecord): void {
    if (this.owners.get(run.sessionId) === run.runId) this.owners.delete(run.sessionId);
  }

  /** A handled failure before the first history save cannot have called the provider. */
  abandon(run: AgentExecutionRecord): Promise<void> {
    return this.serialize(run.sessionId, async () => {
      if (this.owners.get(run.sessionId) !== run.runId)
        throw new ConflictDomainError('Agent execution ownership has changed.');
      await this.write(this.settled(run, 'failed'));
    });
  }

  recover(id: string): Promise<boolean> {
    assertCanonicalAgentSessionId(id);
    return this.serialize(id, async () => {
      if ((await this.repository.deletionState(id)) || this.owners.has(id)) return false;
      const run = await this.read(id);
      if (!run || run.phase === 'settled') return false;
      let recovered: Message[];
      let status: AgentExecutionStatus | 'interrupted';
      if (run.phase === 'completing') {
        recovered = run.messages!;
        status = run.status as AgentExecutionStatus;
        await this.repository.updateMetadata(id, { sdkSessionId: run.sdkSessionId });
      } else {
        // Also preserves a request admitted immediately before its first history write.
        recovered = await this.repository.loadMessages(id);
        if (!recovered.length && !Object.hasOwn(await this.repository.loadMetadata(), id))
          return false;
        const user = recovered.find((item) => item.id === run.userMessage!.id);
        if (user) {
          user.runId = run.runId;
          user.executionStatus = 'interrupted';
        } else recovered.push({ ...run.userMessage!, executionStatus: 'interrupted' });
        const markerId = `msg_execution_recovery_${run.runId}`;
        // Queued execution recovery has its own paused-item warning and explicit resubmit UI.
        if (!run.userMessage!.deliveryId && !recovered.some((item) => item.id === markerId))
          recovered.push({
            id: markerId,
            role: 'assistant',
            timestamp: new Date().toISOString(),
            isError: true,
            content:
              'Interrupted: An agent execution did not commit a terminal result. Its target effects may be unknown. Inspect history and target state before explicitly submitting another request. No automatic replay was performed.',
          });
        await this.repository.clearSdkSessionId(id);
        status = 'interrupted';
      }
      await this.repository.saveMessages(id, recovered);
      await this.repository.touchMetadata(id);
      if (run.phase === 'completing')
        await this.consumeDelivery(
          id,
          recovered.find((item) => item.runId === run.runId && item.role === 'user')!
        );
      await this.write(this.settled(run, status));
      const active = this.sessions.get(id);
      if (active) {
        active.messages = recovered;
        active.sdkSessionId = status === 'interrupted' ? undefined : run.sdkSessionId;
      }
      return true;
    });
  }

  purge(id: string): Promise<void> {
    assertCanonicalAgentSessionId(id);
    return this.serialize(id, async () => {
      if (!(await this.repository.deletionState(id)))
        throw new ConflictDomainError('Session deletion was not admitted.');
      this.owners.delete(id);
      await removeAgentStorageArtifacts(this.directory, `${id}.json`, this.filesystem);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    while (this.writes.size) await Promise.all(this.writes.values());
    this.owners.clear();
  }

  private settled(
    run: AgentExecutionRecord,
    status: AgentExecutionStatus | 'interrupted'
  ): AgentExecutionRecord {
    // A settled ledger must never restore an explicitly cleared history.
    return {
      version: 1,
      sessionId: run.sessionId,
      runId: run.runId,
      createdAt: run.createdAt,
      phase: 'settled',
      status,
    };
  }
  private async consumeDelivery(id: string, user: Message): Promise<void> {
    if (user.deliveryId)
      await this.deliveries.consumeExecution(id, user.deliveryId, user.queuedPromptId);
  }
  private async read(id: string): Promise<AgentExecutionRecord | undefined> {
    let raw: string;
    try {
      raw = String(await this.filesystem.readFile(this.file(id), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new AgentSessionStorageError('read');
    }
    try {
      const run = JSON.parse(raw) as AgentExecutionRecord;
      if (
        run?.version !== 1 ||
        run.sessionId !== id ||
        typeof run.runId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(run.runId) ||
        typeof run.createdAt !== 'string' ||
        (run.sdkSessionId !== undefined && typeof run.sdkSessionId !== 'string')
      )
        throw new Error('Invalid execution');
      if (run.phase === 'settled') {
        if (!terminal(run.status) && run.status !== 'interrupted')
          throw new Error('Invalid disposition');
      } else {
        if (
          !message(run.userMessage) ||
          run.userMessage.role !== 'user' ||
          run.userMessage.runId !== run.runId
        )
          throw new Error('Invalid request');
        if (run.phase === 'completing') {
          if (
            !terminal(run.status) ||
            !Array.isArray(run.messages) ||
            !run.messages.every(message) ||
            !run.messages.some(
              (item) =>
                item.runId === run.runId &&
                item.id === run.userMessage!.id &&
                item.deliveryId === run.userMessage!.deliveryId &&
                item.queuedPromptId === run.userMessage!.queuedPromptId &&
                item.executionStatus === run.status &&
                item.role === 'user'
            )
          )
            throw new Error('Invalid completion');
        } else if (run.phase !== 'running') throw new Error('Invalid phase');
      }
      return run;
    } catch {
      throw new AgentSessionStorageError('read');
    }
  }
  private async write(run: AgentExecutionRecord): Promise<void> {
    await this.repository.assertAvailable(run.sessionId);
    try {
      await atomicWriteJson(this.file(run.sessionId), run, {
        mode: 0o600,
        filesystem: this.filesystem,
      });
    } catch {
      throw new AgentSessionStorageError('write');
    }
  }
  private file(id: string): string {
    assertCanonicalAgentSessionId(id);
    return path.join(this.directory, `${id}.json`);
  }
  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.writes.get(id) ?? Promise.resolve()).then(operation);
    const tail = task.then(
      () => undefined,
      () => undefined
    );
    this.writes.set(id, tail);
    void tail.then(() => {
      if (this.writes.get(id) === tail) this.writes.delete(id);
    });
    return task;
  }
}
