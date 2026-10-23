import { DynamicModule, Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';

import type { LegacyApplication } from '../legacy-application.js';
import { LegacyRouterMiddleware } from './legacy-router.middleware.js';
import {
  DATA_DIRECTORY,
  LEGACY_APPLICATION,
  LEGACY_EVENT_EMITTER,
  LEGACY_SERVICES,
} from './legacy.tokens.js';

@Injectable()
class LegacyLifecycle implements BeforeApplicationShutdown {
  constructor(@Inject(LEGACY_APPLICATION) private readonly legacy: LegacyApplication) {}

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    await this.legacy.shutdown(signal ?? 'Nest application shutdown', { closeHttpServer: false });
  }
}

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
        LegacyRouterMiddleware,
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
