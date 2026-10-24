import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson } from '@automaker/utils';
import * as secureFs from '../../lib/secure-fs.js';
import { ConflictDomainError } from '../../core/errors/domain-errors.js';
import { assertCanonicalAgentSessionId } from './agent-session-id.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';
import { AgentSessionRepository } from './agent-session.repository.js';
import { AgentSessionRegistry } from './agent-session-registry.js';
import type { QueuedPrompt } from './agent-session.types.js';
import { removeAgentStorageArtifacts } from './agent-storage-artifacts.js';

export interface AgentQueueDelivery {
  version: 1;
  sessionId: string;
  deliveryId: string;
  createdAt: string;
  phase: 'claimed' | 'settled';
  disposition?: 'consumed' | 'interrupted';
  prompt: QueuedPrompt;
  consumedPromptIds?: string[];
  blockedDeliveries?: Array<{ promptId: string; deliveryId: string }>;
}

/** Write-ahead queue handoff. A pending delivery is never automatically replayed. */
export class AgentQueueDeliveryStore {
  private readonly directory: string;
  private readonly owners = new Map<string, string>();
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(
    dataDirectory: string,
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry
  ) {
    this.directory = path.join(dataDirectory, 'agent-queue-deliveries');
  }

  claim(id: string, prompt: QueuedPrompt): Promise<AgentQueueDelivery> {
    assertCanonicalAgentSessionId(id);
    const snapshot = globalThis.structuredClone(prompt);
    return this.serialize(id, async () => {
      await this.repository.assertAvailable(id);
      const previous = await this.read(id);
      if (this.owners.has(id) || previous?.phase === 'claimed')
        throw new ConflictDomainError(
          'Recover the previous queued delivery before starting another.'
        );
      const blocked = new Map(
        (previous?.blockedDeliveries ?? []).map((entry) => [entry.promptId, entry.deliveryId])
      );
      if (previous?.disposition === 'interrupted')
        blocked.set(previous.prompt.id, previous.deliveryId);
      const delivery: AgentQueueDelivery = {
        version: 1,
        sessionId: id,
        deliveryId: randomUUID(),
        createdAt: new Date().toISOString(),
        phase: 'claimed',
        prompt: snapshot,
        consumedPromptIds: [
          ...new Set([
            ...(previous?.consumedPromptIds ?? []),
            ...(previous?.disposition === 'consumed' ? [previous.prompt.id] : []),
          ]),
        ],
        blockedDeliveries: [...blocked].map(([promptId, deliveryId]) => ({ promptId, deliveryId })),
      };
      this.owners.set(id, delivery.deliveryId);
      try {
        await this.write(delivery);
      } catch (error) {
        this.owners.delete(id);
        throw error;
      }
      return delivery;
    });
  }

  finish(delivery: AgentQueueDelivery): Promise<void> {
    return this.serialize(delivery.sessionId, async () => {
      if (this.owners.get(delivery.sessionId) !== delivery.deliveryId)
        throw new ConflictDomainError('Queued delivery ownership has changed.');
      await this.write(this.settled(delivery, 'consumed'));
    });
  }

  /** Called only from a durable terminal execution intent, including cold recovery. */
  consumeExecution(id: string, deliveryId: string, promptId: string | undefined): Promise<void> {
    assertCanonicalAgentSessionId(id);
    return this.serialize(id, async () => {
      await this.repository.assertAvailable(id);
      const delivery = await this.read(id);
      if (!delivery || delivery.deliveryId !== deliveryId || delivery.prompt.id !== promptId)
        throw new AgentSessionStorageError('read');
      await this.write(this.settled(delivery, 'consumed'));
    });
  }

  release(delivery: AgentQueueDelivery): void {
    if (this.owners.get(delivery.sessionId) === delivery.deliveryId)
      this.owners.delete(delivery.sessionId);
  }

  isOwned(id: string): boolean {
    return this.owners.has(id);
  }

  purge(id: string): Promise<void> {
    assertCanonicalAgentSessionId(id);
    return this.serialize(id, async () => {
      if (!(await this.repository.deletionState(id)))
        throw new ConflictDomainError('Session deletion was not admitted.');
      this.owners.delete(id);
      await removeAgentStorageArtifacts(this.directory, `${id}.json`);
    });
  }

  /** Call under the queue mutation lock, or during coalesced cold hydration. */
  recover(id: string): Promise<boolean> {
    assertCanonicalAgentSessionId(id);
    return this.serialize(id, async () => {
      if (await this.repository.deletionState(id)) return false;
      if (this.owners.has(id)) return false;
      const delivery = await this.read(id);
      if (!delivery) return false;
      // Metadata deletion is authoritative. A journal must not resurrect a deleted session.
      if (!Object.hasOwn(await this.repository.loadMetadata(), id)) return false;
      const storedQueue = await this.repository.loadQueue(id);
      const messages = await this.repository.loadMessages(id);
      const completedIds = new Set([
        ...(delivery.consumedPromptIds ?? []),
        ...(delivery.disposition === 'consumed' ? [delivery.prompt.id] : []),
        ...messages
          .filter(
            (message) =>
              message.role === 'user' &&
              message.deliveryId &&
              ['completed', 'failed', 'cancelled'].includes(message.deliveryStatus ?? '')
          )
          .map((message) => message.queuedPromptId),
      ]);
      const blocked = new Map(
        (delivery.blockedDeliveries ?? []).map((entry) => [entry.promptId, entry.deliveryId])
      );
      const learnedIds = [...completedIds].filter(
        (value): value is string => typeof value === 'string'
      );
      const ledgerChanged =
        JSON.stringify(learnedIds) !== JSON.stringify(delivery.consumedPromptIds ?? []);
      delivery.consumedPromptIds = learnedIds;
      if (delivery.disposition === 'interrupted')
        blocked.set(delivery.prompt.id, delivery.deliveryId);
      const queue = storedQueue
        .filter((prompt) => !completedIds.has(prompt.id))
        .map((prompt) =>
          blocked.has(prompt.id)
            ? {
                ...prompt,
                deliveryStatus: 'interrupted' as const,
                deliveryId: blocked.get(prompt.id),
              }
            : prompt
        );
      if (JSON.stringify(queue) !== JSON.stringify(storedQueue))
        await this.repository.saveQueue(id, queue);
      if (delivery.disposition === 'interrupted') {
        // An older queue backup must not erase quarantine; removal of the item remains authoritative.
        const paused = queue.map((prompt) =>
          prompt.id === delivery.prompt.id
            ? { ...prompt, deliveryStatus: 'interrupted' as const, deliveryId: delivery.deliveryId }
            : prompt
        );
        if (JSON.stringify(paused) !== JSON.stringify(queue))
          await this.repository.saveQueue(id, paused);
        const active = this.sessions.get(id);
        if (active) active.promptQueue = paused;
        if (ledgerChanged) await this.write(delivery);
        return false;
      }
      const terminal =
        delivery.phase === 'settled' ||
        messages.some(
          (message) =>
            message.role === 'user' &&
            message.deliveryId === delivery.deliveryId &&
            ['completed', 'failed', 'cancelled'].includes(message.deliveryStatus ?? '')
        );
      if (terminal) {
        const remaining = queue.filter((prompt) => prompt.id !== delivery.prompt.id);
        if (remaining.length !== queue.length) await this.repository.saveQueue(id, remaining);
        const active = this.sessions.get(id);
        if (active) active.promptQueue = remaining;
        if (delivery.phase === 'claimed') await this.write(this.settled(delivery, 'consumed'));
        else if (ledgerChanged) await this.write(delivery);
        return false;
      }
      const paused: QueuedPrompt = {
        ...delivery.prompt,
        deliveryStatus: 'interrupted',
        deliveryId: delivery.deliveryId,
      };
      const existing = queue.findIndex((prompt) => prompt.id === paused.id);
      const recovered =
        existing < 0
          ? [paused, ...queue]
          : queue.map((prompt, index) => (index === existing ? paused : prompt));
      await this.repository.saveQueue(id, recovered);
      const markerId = `msg_queue_recovery_${delivery.deliveryId}`;
      if (!messages.some((message) => message.id === markerId)) {
        messages.push({
          id: markerId,
          role: 'assistant',
          timestamp: new Date().toISOString(),
          isError: true,
          content:
            'Interrupted: A queued request did not finish its durable handoff. Its execution outcome may be unknown. The request is paused in the queue; inspect history and target effects before removing or explicitly resubmitting it. No automatic replay was performed.',
        });
        await this.repository.saveMessages(id, messages);
      }
      await this.repository.clearSdkSessionId(id);
      await this.repository.touchMetadata(id);
      const active = this.sessions.get(id);
      if (active) {
        active.promptQueue = recovered;
        active.messages = messages;
        active.sdkSessionId = undefined;
      }
      await this.write(this.settled(delivery, 'interrupted'));
      return true;
    });
  }

  async onApplicationShutdown(): Promise<void> {
    while (this.writes.size) await Promise.all(this.writes.values());
  }

  private settled(
    delivery: AgentQueueDelivery,
    disposition: 'consumed' | 'interrupted'
  ): AgentQueueDelivery {
    const blocked = new Map(
      (delivery.blockedDeliveries ?? []).map((entry) => [entry.promptId, entry.deliveryId])
    );
    if (disposition === 'interrupted') blocked.set(delivery.prompt.id, delivery.deliveryId);
    return {
      ...delivery,
      phase: 'settled',
      disposition,
      consumedPromptIds: [
        ...new Set([
          ...(delivery.consumedPromptIds ?? []),
          ...(disposition === 'consumed' ? [delivery.prompt.id] : []),
        ]),
      ],
      blockedDeliveries: [...blocked].map(([promptId, deliveryId]) => ({ promptId, deliveryId })),
    };
  }

  private async read(id: string): Promise<AgentQueueDelivery | undefined> {
    let raw: string;
    try {
      raw = String(await secureFs.readFile(this.file(id), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new AgentSessionStorageError('read');
    }
    try {
      const record = JSON.parse(raw) as AgentQueueDelivery;
      if (
        record?.version !== 1 ||
        record.sessionId !== id ||
        typeof record.deliveryId !== 'string' ||
        !record.deliveryId ||
        typeof record.createdAt !== 'string' ||
        !['claimed', 'settled'].includes(record.phase) ||
        (record.phase === 'claimed' && record.disposition !== undefined) ||
        (record.phase === 'settled' &&
          !['consumed', 'interrupted'].includes(record.disposition ?? '')) ||
        !record.prompt ||
        (record.consumedPromptIds !== undefined &&
          (!Array.isArray(record.consumedPromptIds) ||
            record.consumedPromptIds.some((value) => typeof value !== 'string'))) ||
        (record.blockedDeliveries !== undefined &&
          (!Array.isArray(record.blockedDeliveries) ||
            record.blockedDeliveries.some(
              (value) =>
                !value || typeof value.promptId !== 'string' || typeof value.deliveryId !== 'string'
            ))) ||
        typeof record.prompt.id !== 'string' ||
        typeof record.prompt.message !== 'string' ||
        typeof record.prompt.addedAt !== 'string'
      )
        throw new Error('Invalid delivery');
      return record;
    } catch {
      throw new AgentSessionStorageError('read');
    }
  }
  private async write(delivery: AgentQueueDelivery): Promise<void> {
    await this.repository.assertAvailable(delivery.sessionId);
    try {
      // No backup rollback: an older "settled" entry must not hide a newer in-flight claim.
      await atomicWriteJson(this.file(delivery.sessionId), delivery, { mode: 0o600 });
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
