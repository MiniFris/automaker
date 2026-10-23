import { DynamicModule, Inject, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';

import type { LegacyApplication } from './legacy-application.js';
import { AuthModule } from './core/auth/index.js';
import { RUNTIME_CONFIG, RuntimeConfigModule, type RuntimeConfig } from './core/config/index.js';
import { ErrorsModule } from './core/errors/index.js';
import { EventingModule } from './core/eventing/index.js';
import { HealthModule } from './core/health/health.module.js';
import { createPlatformMiddleware } from './core/http/platform-middleware.js';
import { LifecycleModule } from './core/lifecycle/lifecycle.module.js';
import { RequestContextMiddleware } from './core/observability/request-context.js';
import { ObservabilityModule } from './core/observability/observability.module.js';
import { SecurityModule } from './core/security/index.js';
import { ValidationModule } from './core/validation/validation.module.js';
import { LegacyModule } from './legacy/legacy.module.js';
import { LegacyRouterMiddleware } from './legacy/legacy-router.middleware.js';

@Module({})
export class AppModule {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  static register(
    legacy: LegacyApplication,
    config: RuntimeConfig,
    workingDirectory: string
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeConfigModule.register(config, workingDirectory),
        LifecycleModule,
        ErrorsModule,
        EventingModule.register(legacy.events),
        ObservabilityModule,
        AuthModule.register(legacy.services.loginAttemptStore),
        SecurityModule,
        ValidationModule,
        HealthModule,
        LegacyModule.register(legacy, config.storage.dataDirectory),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Nest adds the global /api prefix to middleware routes as well.
    consumer
      .apply(
        RequestContextMiddleware,
        ...createPlatformMiddleware(this.config),
        LegacyRouterMiddleware
      )
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
