import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentExecutionCoordinator } from '../../services/agent/agent-execution-coordinator.js';

@Injectable()
export class ChatExecutionReadModel {
  constructor(
    @Inject(AgentSessionRegistry) private readonly sessions: AgentSessionRegistry,
    @Inject(AgentSessionRepository) private readonly repository: AgentSessionRepository,
    @Inject(AgentExecutionCoordinator) private readonly executions: AgentExecutionCoordinator
  ) {}

  async list() {
    if (!this.executions.runningIds().length) return [];
    const metadata = await this.repository.loadMetadata();
    // Recheck after I/O: a completed/deleted run must not survive an old snapshot.
    return this.executions.runningIds().flatMap((sessionId) => {
      const active = this.sessions.get(sessionId);
      const saved = metadata[sessionId];
      const workingDirectory = active?.workingDirectory ?? saved?.workingDirectory;
      const projectPath = active?.projectPath ?? saved?.projectPath ?? workingDirectory;
      if (!projectPath || !workingDirectory) return [];
      return [
        {
          kind: 'chat' as const,
          sessionId,
          featureId: `chat:${sessionId}`,
          projectPath,
          projectName: path.basename(projectPath),
          workingDirectory,
          isAutoMode: false,
          title: saved?.name ?? 'Chat',
          model: active?.model ?? saved?.model,
          provider: active?.providerId ?? saved?.providerId,
        },
      ];
    });
  }
}
