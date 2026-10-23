import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type Provider,
} from '@nestjs/common';

import {
  createLegacyApplication,
  type LegacyApplication,
  type LegacyApplicationOptions,
  type LegacyServiceOverrides,
} from '../legacy-application.js';
import { ReadinessStateService } from '../core/lifecycle/readiness-state.service.js';
import {
  DATA_DIRECTORY,
  LEGACY_APPLICATION,
  LEGACY_EVENT_EMITTER,
  LEGACY_SERVICES,
} from './legacy.tokens.js';

function exposeService(
  provide: symbol,
  select: (services: LegacyServiceOverrides) => unknown
): Provider {
  return {
    provide,
    inject: [LEGACY_APPLICATION],
    useFactory: (application: LegacyApplication) => select(application.services),
  };
}

@Injectable()
class LegacyLifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    @Inject(LEGACY_APPLICATION) private readonly legacy: LegacyApplication,
    @Inject(ReadinessStateService) private readonly readiness: ReadinessStateService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.legacy.initialize();
      this.readiness.markReady();
    } catch (error) {
      this.readiness.markFailed(error);
      throw error;
    }
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.readiness.markStopping();
    await this.legacy.shutdown(signal ?? 'Nest application shutdown');
  }
}

@Global()
export class LegacyModule {
  static register(options: LegacyApplicationOptions, dataDirectory: string): DynamicModule {
    return {
      module: LegacyModule,
      providers: [
        { provide: DATA_DIRECTORY, useValue: dataDirectory },
        {
          provide: LEGACY_APPLICATION,
          useFactory: () => createLegacyApplication(options),
        },
        {
          provide: LEGACY_EVENT_EMITTER,
          inject: [LEGACY_APPLICATION],
          useFactory: (legacy: LegacyApplication) => legacy.events,
        },
        exposeService(LEGACY_SERVICES.settings, (services) => services.settingsService),
        exposeService(LEGACY_SERVICES.agent, (services) => services.agentService),
        exposeService(LEGACY_SERVICES.featureLoader, (services) => services.featureLoader),
        exposeService(LEGACY_SERVICES.autoMode, (services) => services.autoModeService),
        exposeService(LEGACY_SERVICES.claudeUsage, (services) => services.claudeUsageService),
        exposeService(LEGACY_SERVICES.codexAppServer, (services) => services.codexAppServerService),
        exposeService(
          LEGACY_SERVICES.codexModelCache,
          (services) => services.codexModelCacheService
        ),
        exposeService(LEGACY_SERVICES.codexUsage, (services) => services.codexUsageService),
        exposeService(LEGACY_SERVICES.zaiUsage, (services) => services.zaiUsageService),
        exposeService(LEGACY_SERVICES.geminiUsage, (services) => services.geminiUsageService),
        exposeService(LEGACY_SERVICES.mcpTest, (services) => services.mcpTestService),
        exposeService(LEGACY_SERVICES.ideation, (services) => services.ideationService),
        exposeService(LEGACY_SERVICES.devServer, (services) => services.devServerService),
        exposeService(LEGACY_SERVICES.notification, (services) => services.notificationService),
        exposeService(LEGACY_SERVICES.eventHistory, (services) => services.eventHistoryService),
        exposeService(LEGACY_SERVICES.testRunner, (services) => services.testRunnerService),
        exposeService(LEGACY_SERVICES.terminal, (services) => services.terminalService),
        exposeService(LEGACY_SERVICES.pipeline, (services) => services.pipelineService),
        exposeService(LEGACY_SERVICES.eventHook, (services) => services.eventHookService),
        exposeService(LEGACY_SERVICES.loginAttemptStore, (services) => services.loginAttemptStore),
        exposeService(
          LEGACY_SERVICES.providerConnections,
          (services) => services.providerConnections
        ),
        exposeService(LEGACY_SERVICES.providerRegistry, (services) => services.providerRegistry),
        LegacyLifecycle,
      ],
      exports: [
        DATA_DIRECTORY,
        LEGACY_APPLICATION,
        LEGACY_EVENT_EMITTER,
        ...Object.values(LEGACY_SERVICES),
      ],
    };
  }
}
