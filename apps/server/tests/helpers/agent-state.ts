import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../src/services/agent/agent-execution-coordinator.js';

/** Separate persisted state and active registry for each explicit test application. */
export function createTestAgentState(dataDirectory: string) {
  return [
    new AgentSessionRepository(dataDirectory),
    new AgentSessionRegistry(),
    new AgentExecutionCoordinator(),
  ] as const;
}
