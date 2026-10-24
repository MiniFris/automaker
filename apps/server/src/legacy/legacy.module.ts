import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import {
  createLegacyApplication,
  type LegacyApplication,
  type LegacyApplicationOptions,
} from '../legacy-application.js';
import { ReadinessStateService } from '../core/lifecycle/readiness-state.service.js';
import { AgentService } from '../services/agent-service.js';
import { SettingsService } from '../services/settings-service.js';
import type { EventEmitter } from '../lib/events.js';
import { APPLICATION_EVENTS } from '../core/eventing/application-events.js';
import { LEGACY_APPLICATION } from './legacy.tokens.js';
import { assertNoLegacyServiceOverrides } from '../core/config/bootstrap-options.js';
import { AutoModeServiceCompat } from '../services/auto-mode/index.js';
import { DevServerService } from '../services/dev-server-service.js';
import { TestRunnerService } from '../services/test-runner-service.js';
import { TerminalService } from '../services/terminal-service.js';

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
    assertNoLegacyServiceOverrides(options);
    return {
      module: LegacyModule,
      providers: [
        {
          provide: LEGACY_APPLICATION,
          inject: [
            AgentService,
            SettingsService,
            APPLICATION_EVENTS,
            AutoModeServiceCompat,
            DevServerService,
            TestRunnerService,
            TerminalService,
          ],
          useFactory: (
            agents: AgentService,
            settings: SettingsService,
            events: EventEmitter,
            autoMode: AutoModeServiceCompat,
            devServer: DevServerService,
            testRunner: TestRunnerService,
            terminal: TerminalService
          ) => {
            return createLegacyApplication({
              ...options,
              dataDir: dataDirectory,
              resources: { autoMode, devServer, testRunner, terminal },
              agents,
              foundation: { settings, events },
            });
          },
        },
        LegacyLifecycle,
      ],
      exports: [LEGACY_APPLICATION],
    };
  }
}
