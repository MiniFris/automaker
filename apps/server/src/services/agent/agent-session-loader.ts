import path from 'node:path';
import { createLogger } from '@automaker/utils';
import { validateWorkingDirectory } from '../../lib/sdk-options.js';
import { AgentSessionRepository } from './agent-session.repository.js';
import { AgentSessionRegistry } from './agent-session-registry.js';
import type { ActiveSession } from './agent-session.types.js';
import { AgentQueueDeliveryStore } from './agent-queue-delivery-store.js';
import { AgentExecutionStore } from './agent-execution-store.js';

/** Hydrates persisted conversations once per application, never starts or resumes a provider. */
export class AgentSessionLoader {
  private readonly logger = createLogger('AgentSessionLoader');
  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly sessions: AgentSessionRegistry,
    readonly workingDirectory: string,
    private readonly deliveries: AgentQueueDeliveryStore,
    private readonly runs: AgentExecutionStore
  ) {}

  async ensure(id: string, workingDirectory?: string): Promise<ActiveSession | null> {
    if (await this.repository.deletionState(id)) {
      this.sessions.delete(id);
      return null;
    }
    await this.runs.recover(id);
    await this.deliveries.recover(id);
    return this.sessions.getOrLoad(id, () => this.hydrate(id, workingDirectory));
  }

  private async hydrate(id: string, workingDirectory?: string): Promise<ActiveSession | null> {
    // A failed read must propagate; treating it as absence could overwrite conversation history.
    const [metadata, messages] = await Promise.all([
      this.repository.loadMetadata(),
      this.repository.loadMessages(id),
    ]);
    const saved = metadata[id];
    if (!saved && !messages.length) {
      this.logger.warn(`Session "${id}" not found in persisted metadata or messages.`);
      return null;
    }
    const directory = path.resolve(
      this.workingDirectory,
      workingDirectory || saved?.workingDirectory || '.'
    );
    try {
      validateWorkingDirectory(directory);
    } catch {
      this.logger.warn(`Session "${id}" working directory is not allowed.`);
      return null;
    }
    const promptQueue = await this.repository.loadQueue(id);
    return {
      messages,
      isRunning: false,
      abortController: null,
      workingDirectory: directory,
      projectPath: saved?.projectPath ?? directory,
      sdkSessionId: saved?.sdkSessionId,
      model: saved?.model,
      providerId: saved?.providerId,
      promptQueue,
    };
  }
}
