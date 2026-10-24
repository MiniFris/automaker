import { AgentSessionRepository } from '../../src/services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../src/services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../src/services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../src/services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../src/services/agent/agent-environment-preparer.js';
import { AgentProviderSelector } from '../../src/services/agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from '../../src/services/agent/agent-query-options-builder.js';
import type { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import type { ToolPolicyService } from '../../src/modules/providers/tool-policy.service.js';
import { AgentStreamNormalizer } from '../../src/services/agent/agent-stream-normalizer.js';
import { AgentEventPublisher } from '../../src/services/agent/agent-event-publisher.js';
import type { EventEmitter } from '../../src/lib/events.js';

export function createTestAgentEvents(events: EventEmitter) {
  return new AgentEventPublisher(events);
}

export function createTestAgentProviders(registry: ProviderRegistry, policy?: ToolPolicyService) {
  const providers = new AgentProviderSelector(registry, policy);
  return [providers, new AgentQueryOptionsBuilder(providers)] as const;
}

/** Separate persisted state and active registry for each explicit test application. */
export function createTestAgentState(dataDirectory: string) {
  const prompts = new AgentPromptBuilder();
  return [
    new AgentSessionRepository(dataDirectory),
    new AgentSessionRegistry(),
    new AgentExecutionCoordinator(),
    prompts,
    new AgentEnvironmentPreparer(prompts),
    new AgentStreamNormalizer(),
  ] as const;
}
