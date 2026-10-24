import type { InjectionToken, Provider } from '@nestjs/common';
import type { EventEmitter } from '../lib/events.js';
import { APPLICATION_EVENTS } from '../core/eventing/application-events.js';
import type { LegacyApplicationOptions, LegacyServiceOverrides } from '../legacy-application.js';
import { SettingsService } from '../services/settings-service.js';
import { FeatureLoader } from '../services/feature-loader.js';
import { AutoModeServiceCompat } from '../services/auto-mode/index.js';
import { TerminalService } from '../services/terminal-service.js';
import { DevServerService } from '../services/dev-server-service.js';
import { TestRunnerService } from '../services/test-runner-service.js';
import { NotificationService } from '../services/notification-service.js';
import { ProviderRegistry } from '../modules/providers/provider-registry.service.js';
import { ToolPolicyService } from '../modules/providers/tool-policy.service.js';
import { LEGACY_SERVICES as tokens } from './legacy.tokens.js';

/** Transitional token aliases; construction and dependency ordering belong to Nest. */
export const APPLICATION_SERVICE_TOKENS = {
  autoModeService: tokens.autoMode,
  devServerService: tokens.devServer,
  testRunnerService: tokens.testRunner,
  terminalService: tokens.terminal,
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
    service(
      'autoModeService',
      [
        APPLICATION_EVENTS,
        SettingsService,
        FeatureLoader,
        NotificationService,
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
    service('devServerService', [], () => new DevServerService()),
    service('testRunnerService', [APPLICATION_EVENTS], (events: EventEmitter) => {
      const runner = new TestRunnerService();
      runner.setEventEmitter(events);
      return runner;
    }),
    service(
      'terminalService',
      [SettingsService],
      (settings: SettingsService) => new TerminalService(settings)
    ),
  ];
}
