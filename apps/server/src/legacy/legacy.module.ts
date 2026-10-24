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
  type LegacyServiceOverrides,
} from '../legacy-application.js';
import { ReadinessStateService } from '../core/lifecycle/readiness-state.service.js';
import { AgentService } from '../services/agent-service.js';
import {
  DATA_DIRECTORY,
  LEGACY_APPLICATION,
  LEGACY_EVENT_EMITTER,
  LEGACY_SERVICES,
} from './legacy.tokens.js';
import {
  APPLICATION_SERVICE_TOKENS,
  createApplicationServiceProviders,
} from './application-service.providers.js';

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
        ...createApplicationServiceProviders(options),
        {
          provide: LEGACY_APPLICATION,
          inject: [AgentService, ...Object.values(APPLICATION_SERVICE_TOKENS)],
          useFactory: (agents: AgentService, ...instances: unknown[]) => {
            const services = Object.fromEntries(
              Object.keys(APPLICATION_SERVICE_TOKENS).map((key, index) => [key, instances[index]])
            ) as unknown as LegacyServiceOverrides;
            return createLegacyApplication({
              ...options,
              dataDir: dataDirectory,
              services,
              agents,
            });
          },
        },
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
