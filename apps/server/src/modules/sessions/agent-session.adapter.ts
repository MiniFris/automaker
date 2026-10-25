import { Inject, Injectable } from '@nestjs/common';
import { AgentService } from '../../services/agent-service.js';
import type {
  ActiveSessionCoordinator,
  PersistedSessionMetadata,
  SessionMetadataRepository,
} from './session-metadata.repository.js';
import type { SessionCreateRequest, SessionUpdateRequest } from './session.schemas.js';

@Injectable()
export class AgentSessionAdapter implements SessionMetadataRepository, ActiveSessionCoordinator {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  async list(includeArchived: boolean): Promise<PersistedSessionMetadata[]> {
    return (await this.agent.listSessions(includeArchived)) as PersistedSessionMetadata[];
  }

  async loadMessages(sessionId: string): Promise<Array<{ content?: string }>> {
    return (await this.agent.loadSession(sessionId)) as Array<{ content?: string }>;
  }

  async create(
    input: SessionCreateRequest & { workingDirectory: string }
  ): Promise<PersistedSessionMetadata> {
    return (await this.agent.createSession(
      input.name,
      input.projectPath,
      input.workingDirectory,
      input.model,
      input.providerId
    )) as PersistedSessionMetadata;
  }

  async update(
    sessionId: string,
    updates: SessionUpdateRequest
  ): Promise<PersistedSessionMetadata | null> {
    return (await this.agent.updateSessionDetails(
      sessionId,
      updates
    )) as PersistedSessionMetadata | null;
  }

  archive(sessionId: string, archived: boolean): Promise<boolean> {
    return archived ? this.agent.archiveSession(sessionId) : this.agent.unarchiveSession(sessionId);
  }

  deleteAndRelease(sessionId: string): Promise<boolean> {
    return this.agent.deleteSession(sessionId);
  }
}
