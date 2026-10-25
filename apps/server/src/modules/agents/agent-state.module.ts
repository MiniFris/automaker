import { Global, Inject, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, HOST_ENVIRONMENT, type RuntimeConfig } from '../../core/config/index.js';
import { AgentSessionRepository } from '../../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../../services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../../services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../../services/agent/agent-prompt-builder.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
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
import { SecurityService } from '../../core/security/security.service.js';
import { SECURE_FILESYSTEM } from '../../core/security/security.module.js';
import type { AgentStorageFilesystem } from '../../services/agent/agent-storage-filesystem.js';
import { ApplicationMetrics } from '../../core/observability/application-metrics.js';

@Global()
@Module({
  providers: [
    agentServiceProvider,
    AgentSessionRegistry,
    {
      provide: AgentPromptBuilder,
      inject: [SECURE_FILESYSTEM],
      useFactory: (
        filesystem: import('../../services/execution-filesystem.js').ExecutionFilesystem
      ) => new AgentPromptBuilder(filesystem),
    },
    AgentStreamNormalizer,
    {
      provide: AgentExecutionStore,
      inject: [
        RUNTIME_CONFIG,
        AgentSessionRepository,
        AgentSessionRegistry,
        AgentQueueDeliveryStore,
        SECURE_FILESYSTEM,
      ],
      useFactory: (
        config: RuntimeConfig,
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        deliveries: AgentQueueDeliveryStore,
        filesystem: AgentStorageFilesystem
      ) =>
        new AgentExecutionStore(
          config.storage.dataDirectory,
          repository,
          sessions,
          deliveries,
          filesystem
        ),
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
      inject: [RUNTIME_CONFIG, AgentSessionRepository, AgentSessionRegistry, SECURE_FILESYSTEM],
      useFactory: (
        config: RuntimeConfig,
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        filesystem: AgentStorageFilesystem
      ) =>
        new AgentQueueDeliveryStore(config.storage.dataDirectory, repository, sessions, filesystem),
    },
    {
      provide: AgentSessionLoader,
      inject: [
        AgentSessionRepository,
        AgentSessionRegistry,
        RuntimePathsService,
        AgentQueueDeliveryStore,
        AgentExecutionStore,
        SecurityService,
      ],
      useFactory: (
        repository: AgentSessionRepository,
        sessions: AgentSessionRegistry,
        paths: RuntimePathsService,
        deliveries: AgentQueueDeliveryStore,
        runs: AgentExecutionStore,
        security: SecurityService
      ) =>
        new AgentSessionLoader(
          repository,
          sessions,
          paths.workingDirectory,
          deliveries,
          runs,
          (cwd) => {
            security.validateLocalPath(cwd, 'agent session working directory');
          }
        ),
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
      inject: [AgentProviderSelector, SecurityService],
      useFactory: (providers: AgentProviderSelector, security: SecurityService) =>
        new AgentQueryOptionsBuilder(providers, (cwd) => {
          security.validateLocalPath(cwd, 'agent SDK working directory');
        }),
    },
    {
      provide: AgentEnvironmentPreparer,
      inject: [AgentPromptBuilder, HOST_ENVIRONMENT],
      useFactory: (prompts: AgentPromptBuilder, environment: Readonly<NodeJS.ProcessEnv>) =>
        new AgentEnvironmentPreparer(prompts, captureNativeLocalEnvironment(environment)),
    },
    {
      provide: AgentExecutionCoordinator,
      inject: [ApplicationMetrics, AgentSessionRegistry],
      useFactory: (metrics: ApplicationMetrics, sessions: AgentSessionRegistry) => {
        const coordinator = new AgentExecutionCoordinator(5000, (kind, id, task, signal) =>
          metrics.operation(kind, task, id, signal)
        );
        metrics.registerRuntimeGauge('agent_executions', () => coordinator.ids().length);
        metrics.registerRuntimeGauge('agent_mutation_lanes', () => coordinator.pendingMutations);
        metrics.registerRuntimeGauge('loaded_agent_sessions', () => sessions.size);
        metrics.registerRuntimeGauge('loaded_session_queue_depth', () =>
          [...sessions.entries()].reduce(
            (count, [, session]) => count + session.promptQueue.length,
            0
          )
        );
        return coordinator;
      },
    },
    {
      provide: AgentSessionRepository,
      inject: [RUNTIME_CONFIG, SECURE_FILESYSTEM],
      useFactory: (config: RuntimeConfig, filesystem: AgentStorageFilesystem) =>
        new AgentSessionRepository(config.storage.dataDirectory, filesystem),
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
export class AgentStateModule {
  constructor(
    @Inject(AgentExecutionStore) private readonly runs: AgentExecutionStore,
    @Inject(AgentQueueDeliveryStore) private readonly deliveries: AgentQueueDeliveryStore,
    @Inject(AgentSessionRepository) private readonly repository: AgentSessionRepository
  ) {}

  async beforeApplicationShutdown(): Promise<void> {
    // Execution settlement may enqueue delivery/repository writes. Keep downstream stores open.
    await this.runs.onApplicationShutdown();
    await this.deliveries.onApplicationShutdown();
    await this.repository.drain();
  }
}
