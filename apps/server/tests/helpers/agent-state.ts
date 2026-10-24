import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../src/services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../src/services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../src/services/agent/agent-environment-preparer.js';

/** Separate persisted state and active registry for each explicit test application. */
export function createTestAgentState(dataDirectory: string) {
  const prompts = new AgentPromptBuilder();
  return [
    new AgentSessionRepository(dataDirectory),
    new AgentSessionRegistry(),
    new AgentExecutionCoordinator(),
    prompts,
    new AgentEnvironmentPreparer(prompts),
  ] as const;
}
