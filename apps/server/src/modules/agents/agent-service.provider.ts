import type { FactoryProvider } from '@nestjs/common';
import { AgentService } from '../../services/agent-service.js';
import { SettingsService } from '../../services/settings-service.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../services/agent/agent-environment-preparer.js';
import { AgentProviderSelector } from '../../services/agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from '../../services/agent/agent-query-options-builder.js';
import { AgentEventPublisher } from '../../services/agent/agent-event-publisher.js';
import { AgentStreamNormalizer } from '../../services/agent/agent-stream-normalizer.js';
import { AgentSessionLoader } from '../../services/agent/agent-session-loader.js';
import { AgentConversationCoordinator } from '../../services/agent/agent-conversation-coordinator.js';
import { AgentPromptQueue } from '../../services/agent/agent-prompt-queue.js';
import { AgentSessionDeletion } from '../../services/agent/agent-session-deletion.js';
import { AgentExecutionStore } from '../../services/agent/agent-execution-store.js';

/** Nest owns composition; the application service remains framework-independent. */
export const agentServiceProvider: FactoryProvider<AgentService> = {
  provide: AgentService,
  inject: [
    AgentSessionRepository,
    AgentSessionRegistry,
    AgentExecutionCoordinator,
    AgentPromptBuilder,
    AgentEnvironmentPreparer,
    AgentStreamNormalizer,
    AgentSessionLoader,
    AgentConversationCoordinator,
    AgentPromptQueue,
    AgentSessionDeletion,
    AgentExecutionStore,
    AgentEventPublisher,
    SettingsService,
    AgentProviderSelector,
    AgentQueryOptionsBuilder,
  ],
  useFactory: (
    repository: AgentSessionRepository,
    sessions: AgentSessionRegistry,
    executions: AgentExecutionCoordinator,
    prompts: AgentPromptBuilder,
    environments: AgentEnvironmentPreparer,
    streams: AgentStreamNormalizer,
    loader: AgentSessionLoader,
    conversations: AgentConversationCoordinator,
    queue: AgentPromptQueue,
    deletion: AgentSessionDeletion,
    runs: AgentExecutionStore,
    events: AgentEventPublisher,
    settings: SettingsService,
    providers: AgentProviderSelector,
    queries: AgentQueryOptionsBuilder
  ) =>
    new AgentService(
      repository,
      sessions,
      executions,
      prompts,
      environments,
      streams,
      loader,
      conversations,
      queue,
      deletion,
      runs,
      events,
      settings,
      providers,
      queries
    ),
};
