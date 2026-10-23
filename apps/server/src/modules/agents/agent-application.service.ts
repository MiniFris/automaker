import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@automaker/utils';

import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import type { AgentService } from '../../services/agent-service.js';
import type {
  AgentModelRequest,
  AgentQueueAddRequest,
  AgentQueueRemoveRequest,
  AgentSendRequest,
  AgentSessionRequest,
  AgentStartRequest,
} from './agent.schemas.js';

const logger = createLogger('AgentsModule');

@Injectable()
export class AgentApplicationService {
  constructor(@Inject(LEGACY_SERVICES.agent) private readonly agents: AgentService) {}

  start(request: AgentStartRequest): Promise<unknown> {
    return this.agents.startConversation(request);
  }

  send(request: AgentSendRequest): { success: true; message: string } {
    void this.agents.sendMessage(request).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Background agent error for session ${request.sessionId}:`, message);
      this.agents.emitSessionError(request.sessionId, message, error);
    });
    return { success: true, message: 'Message sent' };
  }

  history(request: AgentSessionRequest): Promise<unknown> {
    return this.agents.getHistory(request.sessionId);
  }

  stop(request: AgentSessionRequest): Promise<unknown> {
    return this.agents.stopExecution(request.sessionId);
  }

  clear(request: AgentSessionRequest): Promise<unknown> {
    return this.agents.clearSession(request.sessionId);
  }

  async model(request: AgentModelRequest): Promise<{ success: boolean }> {
    const success = await this.agents.setSessionModel(
      request.sessionId,
      request.model,
      request.providerId
    );
    return { success };
  }

  queueAdd(request: AgentQueueAddRequest): Promise<unknown> {
    const { sessionId, ...prompt } = request;
    return this.agents.addToQueue(sessionId, prompt);
  }

  queueList(request: AgentSessionRequest): Promise<unknown> {
    return this.agents.getQueue(request.sessionId);
  }

  queueRemove(request: AgentQueueRemoveRequest): Promise<unknown> {
    return this.agents.removeFromQueue(request.sessionId, request.promptId);
  }

  queueClear(request: AgentSessionRequest): Promise<unknown> {
    return this.agents.clearQueue(request.sessionId);
  }
}
