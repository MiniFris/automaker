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
import { AgentSessionLoader } from '../../src/services/agent/agent-session-loader.js';
import { AgentConversationCoordinator } from '../../src/services/agent/agent-conversation-coordinator.js';
import { AgentPromptQueue } from '../../src/services/agent/agent-prompt-queue.js';
import { AgentQueueDeliveryStore } from '../../src/services/agent/agent-queue-delivery-store.js';
import { AgentSessionDeletion } from '../../src/services/agent/agent-session-deletion.js';

export function createTestAgentEvents(events: EventEmitter) {
  return new AgentEventPublisher(events);
}

export function createTestAgentProviders(registry: ProviderRegistry, policy?: ToolPolicyService) {
  const providers = new AgentProviderSelector(registry, policy);
  return [providers, new AgentQueryOptionsBuilder(providers)] as const;
}

/** Separate persisted state and active registry for each explicit test application. */
export function createTestAgentState(
  dataDirectory: string,
  events: AgentEventPublisher,
  overrides: {
    repository?: AgentSessionRepository;
    sessions?: AgentSessionRegistry;
    executions?: AgentExecutionCoordinator;
    workingDirectory?: string;
  } = {}
) {
  const repository = overrides.repository ?? new AgentSessionRepository(dataDirectory);
  const sessions = overrides.sessions ?? new AgentSessionRegistry();
  const executions = overrides.executions ?? new AgentExecutionCoordinator();
  const deliveries = new AgentQueueDeliveryStore(dataDirectory, repository, sessions);
  const loader = new AgentSessionLoader(
    repository,
    sessions,
    overrides.workingDirectory ?? process.cwd(),
    deliveries
  );
  const conversations = new AgentConversationCoordinator(
    executions,
    sessions,
    loader,
    repository,
    events
  );
  const prompts = new AgentPromptBuilder();
  return [
    repository,
    sessions,
    executions,
    prompts,
    new AgentEnvironmentPreparer(prompts),
    new AgentStreamNormalizer(),
    loader,
    conversations,
    new AgentPromptQueue(
      repository,
      sessions,
      loader,
      executions,
      conversations,
      events,
      deliveries
    ),
    new AgentSessionDeletion(repository, sessions, executions, deliveries),
    events,
  ] as const;
}
