import { AgentSessionRepository } from './agent-session.repository.js';
import { AgentSessionRegistry } from './agent-session-registry.js';
import { AgentExecutionCoordinator } from './agent-execution-coordinator.js';
import { AgentQueueDeliveryStore } from './agent-queue-delivery-store.js';

/** Retryable, monotonic deletion; the tombstone is committed before any data is removed. */
export class AgentSessionDeletion {
  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry,
    private readonly executions: AgentExecutionCoordinator,
    private readonly deliveries: AgentQueueDeliveryStore
  ) {}

  remove(id: string): Promise<boolean> {
    return this.executions.mutate(id, () =>
      this.sessions.serializeQueue(id, async () => {
        const state = await this.repository.deletionState(id);
        if (state?.phase === 'deleted') return false;
        if (!state && !Object.hasOwn(await this.repository.loadMetadata(), id)) return false;
        await this.repository.markForDeletion(id);
        this.sessions.delete(id);
        await this.repository.removeSessionArtifacts(id);
        await this.deliveries.purge(id);
        await this.repository.deleteMetadata(id);
        await this.repository.purgeMetadataSnapshots();
        await this.repository.completeDeletion(id);
        return true;
      })
    );
  }
}
