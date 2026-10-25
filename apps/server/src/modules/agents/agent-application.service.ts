import type {
  AgentModelInput,
  AgentQueueAddInput,
  AgentQueueRemoveInput,
  AgentSendInput,
  AgentSessionInput,
  AgentStartInput,
} from './application.inputs.js';

import { createLogger } from '@automaker/utils';

import { AgentService } from '../../services/agent-service.js';

const logger = createLogger('AgentsModule');

export class AgentApplicationService {
  constructor(private readonly agents: AgentService) {}

  start(request: AgentStartInput): Promise<unknown> {
    return this.agents.startConversation(request);
  }

  send(request: AgentSendInput): { success: true; message: string } {
    void this.agents.sendMessage(request).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Background agent error for session ${request.sessionId}:`, message);
      this.agents.emitSessionError(request.sessionId, message, error);
    });
    return { success: true, message: 'Message sent' };
  }

  history(request: AgentSessionInput): Promise<unknown> {
    return this.agents.getHistory(request.sessionId);
  }

  stop(request: AgentSessionInput): Promise<unknown> {
    return this.agents.stopExecution(request.sessionId);
  }

  clear(request: AgentSessionInput): Promise<unknown> {
    return this.agents.clearSession(request.sessionId);
  }

  async model(request: AgentModelInput): Promise<{ success: boolean }> {
    const success = await this.agents.setSessionModel(
      request.sessionId,
      request.model,
      request.providerId
    );
    return { success };
  }

  queueAdd(request: AgentQueueAddInput): Promise<unknown> {
    const { sessionId, ...prompt } = request;
    return this.agents.addToQueue(sessionId, prompt);
  }

  queueList(request: AgentSessionInput): Promise<unknown> {
    return this.agents.getQueue(request.sessionId);
  }

  queueRemove(request: AgentQueueRemoveInput): Promise<unknown> {
    return this.agents.removeFromQueue(request.sessionId, request.promptId);
  }

  queueClear(request: AgentSessionInput): Promise<unknown> {
    return this.agents.clearQueue(request.sessionId);
  }
}
