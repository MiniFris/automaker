import { Global, Module } from '@nestjs/common';
import { METRICS } from './metrics.js';
import { ApplicationMetrics } from './application-metrics.js';
import { MetricsController } from './metrics.controller.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [ApplicationMetrics, { provide: METRICS, useExisting: ApplicationMetrics }],
  exports: [METRICS, ApplicationMetrics],
})
export class ObservabilityModule {}
