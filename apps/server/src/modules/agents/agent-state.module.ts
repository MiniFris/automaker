import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../../services/agent/agent-environment-preparer.js';
import { AgentProviderSelector } from '../../services/agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from '../../services/agent/agent-query-options-builder.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { ToolPolicyService } from '../providers/tool-policy.service.js';
import { EVENT_BUS, type EventBus } from '../../core/eventing/event-bus.js';
import { AgentEventPublisher } from '../../services/agent/agent-event-publisher.js';
import { AgentStreamNormalizer } from '../../services/agent/agent-stream-normalizer.js';
import { RuntimePathsService } from '../../core/config/index.js';
import { AgentSessionLoader } from '../../services/agent/agent-session-loader.js';
import { AgentConversationCoordinator } from '../../services/agent/agent-conversation-coordinator.js';
import { AgentPromptQueue } from '../../services/agent/agent-prompt-queue.js';
import { AgentQueueDeliveryStore } from '../../services/agent/agent-queue-delivery-store.js';
import { AgentSessionDeletion } from '../../services/agent/agent-session-deletion.js';
import { AgentExecutionStore } from '../../services/agent/agent-execution-store.js';
import { AgentService } from '../../services/agent-service.js';
import { agentServiceProvider } from './agent-service.provider.js';

@Global()
@Module({
  providers: [
    agentServiceProvider,
    AgentSessionRegistry,
    AgentPromptBuilder,
    AgentStreamNormalizer,
    {
      provide: AgentExecutionStore,
      inject: [
        RUNTIME_CONFIG,
        AgentSessionRepository,
        AgentSessionRegistry,
        AgentQueueDeliveryStore,
      ],
      useFactory: (
        config: RuntimeConfig,
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        deliveries: AgentQueueDeliveryStore
      ) => new AgentExecutionStore(config.storage.dataDirectory, repository, sessions, deliveries),
    },
    {
      provide: AgentSessionDeletion,
      inject: [
        AgentSessionRepository,
        AgentSessionRegistry,
        AgentExecutionCoordinator,
        AgentQueueDeliveryStore,
        AgentExecutionStore,
      ],
      useFactory: (
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        executions: AgentExecutionCoordinator,
        deliveries: AgentQueueDeliveryStore,
        runs: AgentExecutionStore
      ) => new AgentSessionDeletion(repository, sessions, executions, deliveries, runs),
    },
    {
      provide: AgentQueueDeliveryStore,
      inject: [RUNTIME_CONFIG, AgentSessionRepository, AgentSessionRegistry],
      useFactory: (
        config: RuntimeConfig,
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry
      ) => new AgentQueueDeliveryStore(config.storage.dataDirectory, repository, sessions),
    },
    {
      provide: AgentSessionLoader,
      inject: [
        AgentSessionRepository,
        AgentSessionRegistry,
        RuntimePathsService,
        AgentQueueDeliveryStore,
        AgentExecutionStore,
      ],
      useFactory: (
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        paths: RuntimePathsService,
        deliveries: AgentQueueDeliveryStore,
        runs: AgentExecutionStore
      ) => new AgentSessionLoader(repository, sessions, paths.workingDirectory, deliveries, runs),
    },
    {
      provide: AgentConversationCoordinator,
      inject: [
        AgentExecutionCoordinator,
        AgentSessionRegistry,
        AgentSessionLoader,
        AgentSessionRepository,
        AgentEventPublisher,
      ],
      useFactory: (
        executions: AgentExecutionCoordinator,
        sessions: AgentSessionRegistry,
        loader: AgentSessionLoader,
        repository: AgentSessionRepository,
        events: AgentEventPublisher
      ) => new AgentConversationCoordinator(executions, sessions, loader, repository, events),
    },
    {
      provide: AgentPromptQueue,
      inject: [
        AgentSessionRepository,
        AgentSessionRegistry,
        AgentSessionLoader,
        AgentExecutionCoordinator,
        AgentConversationCoordinator,
        AgentEventPublisher,
        AgentQueueDeliveryStore,
      ],
      useFactory: (
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        loader: AgentSessionLoader,
        executions: AgentExecutionCoordinator,
        conversations: AgentConversationCoordinator,
        events: AgentEventPublisher,
        deliveries: AgentQueueDeliveryStore
      ) =>
        new AgentPromptQueue(
          repository,
          sessions,
          loader,
          executions,
          conversations,
          events,
          deliveries
        ),
    },
    {
      provide: AgentEventPublisher,
      inject: [EVENT_BUS],
      useFactory: (bus: EventBus) => new AgentEventPublisher(bus),
    },
    {
      provide: AgentProviderSelector,
      inject: [ProviderRegistry, ToolPolicyService],
      useFactory: (registry: ProviderRegistry, policy: ToolPolicyService) =>
        new AgentProviderSelector(registry, policy),
    },
    {
      provide: AgentQueryOptionsBuilder,
      inject: [AgentProviderSelector],
      useFactory: (providers: AgentProviderSelector) => new AgentQueryOptionsBuilder(providers),
    },
    {
      provide: AgentEnvironmentPreparer,
      inject: [AgentPromptBuilder],
      useFactory: (prompts: AgentPromptBuilder) => new AgentEnvironmentPreparer(prompts),
    },
    { provide: AgentExecutionCoordinator, useFactory: () => new AgentExecutionCoordinator() },
    {
      provide: AgentSessionRepository,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new AgentSessionRepository(config.storage.dataDirectory),
    },
  ],
  exports: [
    AgentService,
    AgentExecutionStore,
    AgentSessionDeletion,
    AgentSessionRegistry,
    AgentSessionRepository,
    AgentExecutionCoordinator,
    AgentPromptBuilder,
    AgentEnvironmentPreparer,
    AgentProviderSelector,
    AgentQueryOptionsBuilder,
    AgentEventPublisher,
    AgentStreamNormalizer,
    AgentSessionLoader,
    AgentConversationCoordinator,
    AgentPromptQueue,
    AgentQueueDeliveryStore,
  ],
})
export class AgentStateModule {}
