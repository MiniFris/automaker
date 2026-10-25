import { DynamicModule, Global, Module } from '@nestjs/common';
import { HOST_ENVIRONMENT, RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';
import { ApplicationLoggingPolicy } from './logging-policy.js';
import { METRICS } from './metrics.js';
import { ApplicationMetrics } from './application-metrics.js';
import { MetricsController } from './metrics.controller.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [ApplicationMetrics, { provide: METRICS, useExisting: ApplicationMetrics }],
  exports: [METRICS, ApplicationMetrics],
})
export class ObservabilityModule {
  static register(policy?: ApplicationLoggingPolicy): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [
        policy
          ? { provide: ApplicationLoggingPolicy, useValue: policy }
          : {
              provide: ApplicationLoggingPolicy,
              inject: [HOST_ENVIRONMENT, RUNTIME_CONFIG],
              useFactory: (environment: NodeJS.ProcessEnv, config: RuntimeConfig) =>
                new ApplicationLoggingPolicy(environment, config.server.requestLogging),
            },
      ],
      exports: [ApplicationLoggingPolicy],
    };
  }
}
