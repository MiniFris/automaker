import type { InjectionToken, Provider } from '@nestjs/common';
import { createEventEmitter, type EventEmitter } from '../lib/events.js';
import type { LegacyApplicationOptions, LegacyServiceOverrides } from '../legacy-application.js';
import { SettingsService } from '../services/settings-service.js';
import { FeatureLoader } from '../services/feature-loader.js';
import { AutoModeServiceCompat } from '../services/auto-mode/index.js';
import { TerminalService } from '../services/terminal-service.js';
import { MCPTestService } from '../services/mcp-test-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { IdeationService } from '../services/ideation-service.js';
import { DevServerService } from '../services/dev-server-service.js';
import { TestRunnerService } from '../services/test-runner-service.js';
import { EventHookService } from '../services/event-hook-service.js';
import { NotificationService } from '../services/notification-service.js';
import { EventHistoryService } from '../services/event-history-service.js';
import { LoginAttemptStore } from '../core/auth/login-attempt.store.js';
import { ProviderRegistry } from '../modules/providers/provider-registry.service.js';
import { ToolPolicyService } from '../modules/providers/tool-policy.service.js';
import {
  DATA_DIRECTORY,
  LEGACY_EVENT_EMITTER,
  LEGACY_SERVICES as tokens,
} from './legacy.tokens.js';

/** Transitional token aliases; construction and dependency ordering belong to Nest. */
export const APPLICATION_SERVICE_TOKENS = {
  events: LEGACY_EVENT_EMITTER,
  settingsService: tokens.settings,
  featureLoader: tokens.featureLoader,
  autoModeService: tokens.autoMode,
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
} satisfies Record<keyof LegacyServiceOverrides, symbol>;

export function createApplicationServiceProviders(options: LegacyApplicationOptions): Provider[] {
  for (const key of Object.keys(options.services ?? {})) {
    if (!Object.hasOwn(APPLICATION_SERVICE_TOKENS, key))
      throw new Error(
        'Unknown legacy service override. Configure native services through their owning modules.'
      );
  }
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
    service('events', [], createEventEmitter),
    service('settingsService', [DATA_DIRECTORY], (dataDir: string) => new SettingsService(dataDir)),
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
        ProviderRegistry,
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
    service(
      'mcpTestService',
      [tokens.settings],
      (settings: SettingsService) => new MCPTestService(settings)
    ),
    service(
      'ideationService',
      [LEGACY_EVENT_EMITTER, tokens.settings, tokens.featureLoader, ProviderRegistry],
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
