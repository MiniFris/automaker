import type { InjectionToken, Provider } from '@nestjs/common';
import { createEventEmitter, type EventEmitter } from '../lib/events.js';
import type { LegacyApplicationOptions, LegacyServiceOverrides } from '../legacy-application.js';
import { SettingsService } from '../services/settings-service.js';
import { AgentService } from '../services/agent-service.js';
import { AgentSessionRepository } from '../services/agent/agent-session.repository.js';
import { AgentSessionRegistry } from '../services/agent/agent-session-registry.js';
import { AgentExecutionCoordinator } from '../services/agent/agent-execution-coordinator.js';
import { AgentPromptBuilder } from '../services/agent/agent-prompt-builder.js';
import { AgentEnvironmentPreparer } from '../services/agent/agent-environment-preparer.js';
import { AgentProviderSelector } from '../services/agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from '../services/agent/agent-query-options-builder.js';
import { AgentEventPublisher } from '../services/agent/agent-event-publisher.js';
import { AgentStreamNormalizer } from '../services/agent/agent-stream-normalizer.js';
import { AgentSessionLoader } from '../services/agent/agent-session-loader.js';
import { AgentConversationCoordinator } from '../services/agent/agent-conversation-coordinator.js';
import { AgentPromptQueue } from '../services/agent/agent-prompt-queue.js';
import { AgentSessionDeletion } from '../services/agent/agent-session-deletion.js';
import { AgentExecutionStore } from '../services/agent/agent-execution-store.js';
import { FeatureLoader } from '../services/feature-loader.js';
import { AutoModeServiceCompat } from '../services/auto-mode/index.js';
import { TerminalService } from '../services/terminal-service.js';
import { ClaudeUsageService } from '../services/claude-usage-service.js';
import { CodexUsageService } from '../services/codex-usage-service.js';
import { CodexAppServerService } from '../services/codex-app-server-service.js';
import { CodexModelCacheService } from '../services/codex-model-cache-service.js';
import { ZaiUsageService } from '../services/zai-usage-service.js';
import { GeminiUsageService } from '../services/gemini-usage-service.js';
import { MCPTestService } from '../services/mcp-test-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { IdeationService } from '../services/ideation-service.js';
import { DevServerService } from '../services/dev-server-service.js';
import { TestRunnerService } from '../services/test-runner-service.js';
import { EventHookService } from '../services/event-hook-service.js';
import { NotificationService } from '../services/notification-service.js';
import { EventHistoryService } from '../services/event-history-service.js';
import { LoginAttemptStore } from '../core/auth/login-attempt.store.js';
import { ProviderConnectionRepository } from '../modules/providers/provider-connection.repository.js';
import { createProviderRegistrations } from '../modules/providers/provider-registrations.js';
import { ProviderRegistry } from '../modules/providers/provider-registry.service.js';
import { ToolPolicyService } from '../modules/providers/tool-policy.service.js';
import { RuntimePathsService } from '../core/config/index.js';
import { ApplicationCredentialsService } from '../modules/providers/application-credentials.service.js';
import {
  DATA_DIRECTORY,
  LEGACY_EVENT_EMITTER,
  LEGACY_SERVICES as tokens,
} from './legacy.tokens.js';

/** Transitional token aliases; construction and dependency ordering belong to Nest. */
export const APPLICATION_SERVICE_TOKENS = {
  events: LEGACY_EVENT_EMITTER,
  settingsService: tokens.settings,
  agentService: tokens.agent,
  featureLoader: tokens.featureLoader,
  autoModeService: tokens.autoMode,
  claudeUsageService: tokens.claudeUsage,
  codexAppServerService: tokens.codexAppServer,
  codexModelCacheService: tokens.codexModelCache,
  codexUsageService: tokens.codexUsage,
  zaiUsageService: tokens.zaiUsage,
  geminiUsageService: tokens.geminiUsage,
  mcpTestService: tokens.mcpTest,
  ideationService: tokens.ideation,
  devServerService: tokens.devServer,
  notificationService: tokens.notification,
  eventHistoryService: tokens.eventHistory,
  testRunnerService: tokens.testRunner,
  terminalService: tokens.terminal,
  pipelineService: tokens.pipeline,
  eventHookService: tokens.eventHook,
  loginAttemptStore: tokens.loginAttemptStore,
  providerConnections: tokens.providerConnections,
  providerRegistry: tokens.providerRegistry,
} satisfies Record<keyof LegacyServiceOverrides, symbol>;

export function createApplicationServiceProviders(options: LegacyApplicationOptions): Provider[] {
  function service<K extends keyof LegacyServiceOverrides, Args extends unknown[]>(
    key: K,
    inject: InjectionToken[],
    useFactory: (...args: Args) => LegacyServiceOverrides[K]
  ): Provider {
    const provide = APPLICATION_SERVICE_TOKENS[key];
    const override = options.services?.[key];
    return override !== undefined
      ? { provide, useValue: override }
      : { provide, inject, useFactory };
  }

  return [
    ToolPolicyService,
    service('events', [], createEventEmitter),
    service('settingsService', [DATA_DIRECTORY], (dataDir: string) => new SettingsService(dataDir)),
    service(
      'providerConnections',
      [RuntimePathsService],
      (paths: RuntimePathsService) => new ProviderConnectionRepository(paths)
    ),
    service(
      'providerRegistry',
      [tokens.settings, tokens.providerConnections, ApplicationCredentialsService],
      (
        settings: SettingsService,
        connections: ProviderConnectionRepository,
        credentials: ApplicationCredentialsService
      ) =>
        new ProviderRegistry(
          createProviderRegistrations(settings, () => credentials.environment()),
          connections
        )
    ),
    service(
      'agentService',
      [
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
        tokens.settings,
        AgentProviderSelector,
        AgentQueryOptionsBuilder,
      ],
      (
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
        )
    ),
    service('featureLoader', [], () => new FeatureLoader()),
    service('notificationService', [LEGACY_EVENT_EMITTER], (events: EventEmitter) => {
      const notifications = new NotificationService();
      notifications.setEventEmitter(events);
      return notifications;
    }),
    service('eventHistoryService', [], () => new EventHistoryService()),
    service(
      'autoModeService',
      [
        LEGACY_EVENT_EMITTER,
        tokens.settings,
        tokens.featureLoader,
        tokens.notification,
        tokens.providerRegistry,
        ToolPolicyService,
      ],
      (
        events: EventEmitter,
        settings: SettingsService,
        features: FeatureLoader,
        notifications: NotificationService,
        providers: ProviderRegistry,
        policy: ToolPolicyService
      ) =>
        new AutoModeServiceCompat(
          events,
          settings,
          features,
          null,
          notifications,
          providers,
          policy
        )
    ),
    service('claudeUsageService', [], () => new ClaudeUsageService()),
    service('codexAppServerService', [], () => new CodexAppServerService()),
    service(
      'codexModelCacheService',
      [DATA_DIRECTORY, tokens.codexAppServer],
      (dataDir: string, codex: CodexAppServerService) => new CodexModelCacheService(dataDir, codex)
    ),
    service(
      'codexUsageService',
      [tokens.codexAppServer],
      (codex: CodexAppServerService) => new CodexUsageService(codex)
    ),
    service('zaiUsageService', [], () => new ZaiUsageService()),
    service('geminiUsageService', [], () => new GeminiUsageService()),
    service(
      'mcpTestService',
      [tokens.settings],
      (settings: SettingsService) => new MCPTestService(settings)
    ),
    service(
      'ideationService',
      [LEGACY_EVENT_EMITTER, tokens.settings, tokens.featureLoader, tokens.providerRegistry],
      (
        events: EventEmitter,
        settings: SettingsService,
        features: FeatureLoader,
        providers: ProviderRegistry
      ) => new IdeationService(events, settings, features, providers)
    ),
    service('devServerService', [], () => new DevServerService()),
    service('testRunnerService', [LEGACY_EVENT_EMITTER], (events: EventEmitter) => {
      const runner = new TestRunnerService();
      runner.setEventEmitter(events);
      return runner;
    }),
    service(
      'terminalService',
      [tokens.settings],
      (settings: SettingsService) => new TerminalService(settings)
    ),
    service('pipelineService', [], () => new PipelineService()),
    service('eventHookService', [], () => new EventHookService()),
    service('loginAttemptStore', [], () => new LoginAttemptStore()),
  ];
}
