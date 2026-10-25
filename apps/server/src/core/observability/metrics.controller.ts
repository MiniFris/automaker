import { Controller, Get, Inject } from '@nestjs/common';
import { ApplicationMetrics } from './application-metrics.js';
import { MetricsSnapshotSchema } from '@automaker/contracts';

/** Protected by the application's normal authentication guard. */
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(ApplicationMetrics) private readonly metrics: ApplicationMetrics) {}
  @Get()
  snapshot() {
    return MetricsSnapshotSchema.parse(this.metrics.snapshot());
  }
}
