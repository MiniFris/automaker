import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import type { LegacyApplication } from '../legacy-application.js';
import { ReadinessStateService } from '../core/lifecycle/readiness-state.service.js';
import {
  DATA_DIRECTORY,
  LEGACY_APPLICATION,
  LEGACY_EVENT_EMITTER,
  LEGACY_SERVICES,
} from './legacy.tokens.js';

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
    await this.legacy.shutdown(signal ?? 'Nest application shutdown', { closeHttpServer: false });
  }
}

@Global()
export class LegacyModule {
  static register(legacy: LegacyApplication, dataDirectory: string): DynamicModule {
    return {
      module: LegacyModule,
      providers: [
        { provide: DATA_DIRECTORY, useValue: dataDirectory },
        { provide: LEGACY_APPLICATION, useValue: legacy },
        { provide: LEGACY_EVENT_EMITTER, useValue: legacy.events },
        { provide: LEGACY_SERVICES.settings, useValue: legacy.services.settingsService },
        { provide: LEGACY_SERVICES.agent, useValue: legacy.services.agentService },
        { provide: LEGACY_SERVICES.featureLoader, useValue: legacy.services.featureLoader },
        { provide: LEGACY_SERVICES.autoMode, useValue: legacy.services.autoModeService },
        { provide: LEGACY_SERVICES.claudeUsage, useValue: legacy.services.claudeUsageService },
        {
          provide: LEGACY_SERVICES.codexAppServer,
          useValue: legacy.services.codexAppServerService,
        },
        {
          provide: LEGACY_SERVICES.codexModelCache,
          useValue: legacy.services.codexModelCacheService,
        },
        { provide: LEGACY_SERVICES.codexUsage, useValue: legacy.services.codexUsageService },
        { provide: LEGACY_SERVICES.zaiUsage, useValue: legacy.services.zaiUsageService },
        { provide: LEGACY_SERVICES.geminiUsage, useValue: legacy.services.geminiUsageService },
        { provide: LEGACY_SERVICES.mcpTest, useValue: legacy.services.mcpTestService },
        { provide: LEGACY_SERVICES.ideation, useValue: legacy.services.ideationService },
        { provide: LEGACY_SERVICES.devServer, useValue: legacy.services.devServerService },
        {
          provide: LEGACY_SERVICES.notification,
          useValue: legacy.services.notificationService,
        },
        {
          provide: LEGACY_SERVICES.eventHistory,
          useValue: legacy.services.eventHistoryService,
        },
        { provide: LEGACY_SERVICES.testRunner, useValue: legacy.services.testRunnerService },
        { provide: LEGACY_SERVICES.terminal, useValue: legacy.services.terminalService },
        { provide: LEGACY_SERVICES.pipeline, useValue: legacy.services.pipelineService },
        { provide: LEGACY_SERVICES.eventHook, useValue: legacy.services.eventHookService },
        { provide: LEGACY_SERVICES.loginAttemptStore, useValue: legacy.services.loginAttemptStore },
        {
          provide: LEGACY_SERVICES.providerConnections,
          useValue: legacy.services.providerConnections,
        },
        { provide: LEGACY_SERVICES.providerRegistry, useValue: legacy.services.providerRegistry },
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
