import { Global, Module } from '@nestjs/common';
import { METRICS, NoopMetrics } from './metrics.js';

@Global()
@Module({ providers: [{ provide: METRICS, useClass: NoopMetrics }], exports: [METRICS] })
export class ObservabilityModule {}
