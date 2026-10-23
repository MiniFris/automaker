import { DynamicModule, MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';

import type { LegacyApplication } from './legacy-application.js';
import { LegacyModule } from './legacy/legacy.module.js';
import { LegacyRouterMiddleware } from './legacy/legacy-router.middleware.js';

@Module({})
export class AppModule {
  static register(legacy: LegacyApplication, dataDirectory: string): DynamicModule {
    return {
      module: AppModule,
      imports: [LegacyModule.register(legacy, dataDirectory)],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Nest adds the global /api prefix to middleware routes as well.
    consumer
      .apply(LegacyRouterMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
