import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@automaker/utils';
import type { Metrics } from './metrics.js';
import { getCorrelationId, getOperationId, runWithOperationContext } from './request-context.js';
import type { OperationIdentity, OperationKind, OperationOutcome } from './operation-observer.js';

const logger = createLogger('Operations');
const LIMIT = 2048;
const PROVIDER_RESERVE = 16;
const BOUNDS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 30000];
type Labels = Readonly<Record<string, string>>;
interface Series {
  name: string;
  labels: Labels;
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
}
export interface ProviderObservation {
  failed: boolean;
  cancelled: boolean;
  unconfirmed: boolean;
}

/** Application-owned, bounded aggregates. No request bodies, prompts or per-run history. */
@Injectable()
export class ApplicationMetrics implements Metrics {
  private readonly started = performance.now();
  private readonly counters = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly observations = new Map<string, Series>();
  private dropped = 0;
  private providerActive = 0;
  private readonly runtimeReaders = new Map<string, () => number>();

  /** Passive, bounded readers only: no discovery, filesystem or process probes. */
  registerRuntimeGauge(name: string, reader: () => number): () => void {
    if (
      !/^[a-z][a-z0-9_]{0,79}$/.test(name) ||
      this.runtimeReaders.has(name) ||
      this.runtimeReaders.size >= 32
    )
      throw new Error('Invalid or duplicate runtime metric registration.');
    this.runtimeReaders.set(name, reader);
    return () => {
      if (this.runtimeReaders.get(name) === reader) this.runtimeReaders.delete(name);
    };
  }

  async operation<T>(
    kind: OperationKind,
    task: () => Promise<T>,
    identity?: string | OperationIdentity,
    signal?: AbortSignal,
    classify?: (result: T) => OperationOutcome
  ): Promise<T> {
    const correlationId = getCorrelationId() ?? randomUUID();
    const operationId = randomUUID();
    const parentOperationId = getOperationId();
    const subject = typeof identity === 'string' ? { sessionId: identity } : identity;
    const safeId = (value: unknown): value is string =>
      typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
    const context = {
      correlationId,
      operationId,
      ...(parentOperationId && { parentOperationId }),
      kind,
      ...(safeId(subject?.sessionId) && { sessionId: subject.sessionId }),
      ...(safeId(subject?.featureId) && { featureId: subject.featureId }),
      ...(['legacy', 'local', 'docker', 'ssh'].includes(subject?.executionType ?? '') && {
        executionType: subject!.executionType,
      }),
    };
    const started = performance.now();
    logger.debug('operation started', context);
    let outcome: OperationOutcome = 'completed';
    try {
      const result = await runWithOperationContext(correlationId, operationId, task);
      outcome = classify?.(result) ?? 'completed';
      return result;
    } catch (error) {
      const fields = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
      outcome =
        (error instanceof Error && error.name === 'ProviderCleanupError') ||
        (typeof fields.code === 'string' &&
          [
            'PROCESS_CLEANUP_FAILED',
            'LOCAL_PROCESS_CLEANUP_FAILED',
            'SSH_OUTCOME_UNKNOWN',
            'DOCKER_PROBE_CLEANUP_FAILED',
          ].includes(fields.code)) ||
        fields.errorCode === 'UNKNOWN_OUTCOME'
          ? 'unknown'
          : error instanceof Error && error.name === 'AbortError'
            ? 'cancelled'
            : 'error';
      throw error;
    } finally {
      // A transport can abort only to retire its successful reader/process. A caller
      // with a result classifier distinguishes that cleanup from user cancellation.
      if (!classify && outcome === 'completed' && signal?.aborted) outcome = 'cancelled';
      const durationMs = performance.now() - started;
      this.increment('operations_total', { kind, outcome });
      this.observe('operation_duration_ms', durationMs, { kind, outcome });
      logger.debug('operation settled', { ...context, outcome, durationMs });
    }
  }

  private identity(name: string, labels: Labels): { key: string; labels: Labels } | undefined {
    const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    if (
      !/^[a-z][a-z0-9_]{0,79}$/.test(name) ||
      pairs.length > 8 ||
      pairs.some(
        ([key, value]) =>
          !/^[a-z][a-z0-9_]{0,39}$/.test(key) || typeof value !== 'string' || value.length > 160
      )
    ) {
      this.dropped++;
      return undefined;
    }
    return { key: JSON.stringify([name, pairs]), labels: Object.fromEntries(pairs) };
  }

  increment(name: string, labels: Labels = {}): void {
    const identity = this.identity(name, labels);
    if (!identity) return;
    const existing = this.counters.get(identity.key);
    if (existing) {
      existing.value++;
      return;
    }
    if (
      this.counters.size + this.observations.size >=
      LIMIT - (name.startsWith('provider_') ? 0 : PROVIDER_RESERVE)
    ) {
      this.dropped++;
      return;
    }
    this.counters.set(identity.key, { name, labels: identity.labels, value: 1 });
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value) || value < 0) {
      this.dropped++;
      return;
    }
    const identity = this.identity(name, labels);
    if (!identity) return;
    let series = this.observations.get(identity.key);
    if (!series) {
      if (
        this.counters.size + this.observations.size >=
        LIMIT - (name.startsWith('provider_') ? 0 : PROVIDER_RESERVE)
      ) {
        this.dropped++;
        return;
      }
      series = {
        name,
        labels: identity.labels,
        count: 0,
        sum: 0,
        min: value,
        max: value,
        buckets: BOUNDS.map(() => 0),
      };
      this.observations.set(identity.key, series);
    }
    if (!Number.isFinite(series.sum + value)) {
      this.dropped++;
      return;
    }
    series.count++;
    series.sum += value;
    series.min = Math.min(series.min, value);
    series.max = Math.max(series.max, value);
    BOUNDS.forEach((bound, index) => {
      if (value <= bound) series.buckets[index]++;
    });
  }

  providerQueryStarted(): (result: ProviderObservation) => void {
    const started = performance.now();
    const correlationId = getCorrelationId();
    const operationId = randomUUID();
    const parentOperationId = getOperationId();
    const context = { correlationId, operationId, ...(parentOperationId && { parentOperationId }) };
    this.providerActive++;
    logger.debug('provider query started', context);
    let finished = false;
    return (result) => {
      if (finished) return;
      finished = true;
      if (!result.unconfirmed) this.providerActive--;
      const outcome = result.unconfirmed
        ? 'unknown'
        : result.cancelled
          ? 'cancelled'
          : result.failed
            ? 'error'
            : 'completed';
      const durationMs = performance.now() - started;
      this.increment('provider_queries_total', { outcome });
      if (outcome === 'error' || outcome === 'unknown')
        this.increment('provider_errors_total', { outcome });
      this.observe('provider_query_duration_ms', durationMs, { outcome });
      logger.debug('provider query settled', { ...context, outcome, durationMs });
    };
  }

  snapshot() {
    return {
      schemaVersion: 1 as const,
      uptimeMs: performance.now() - this.started,
      providerActiveQueries: this.providerActive,
      droppedMeasurements: this.dropped,
      seriesLimit: LIMIT,
      runtimeGauges: [...this.runtimeReaders].map(([name, read]) => {
        let value: number | null = null;
        try {
          const measured = read();
          if (Number.isSafeInteger(measured) && measured >= 0) value = measured;
        } catch {
          /* An unavailable diagnostic must not become a fabricated zero. */
        }
        return { name, value };
      }),
      counters: [...this.counters.values()].map((series) => ({
        ...series,
        labels: { ...series.labels },
      })),
      observations: [...this.observations.values()].map((series) => ({
        name: series.name,
        labels: { ...series.labels },
        count: series.count,
        sum: series.sum,
        min: series.min,
        max: series.max,
        buckets: BOUNDS.map((upperBound, index) => ({ upperBound, count: series.buckets[index] })),
      })),
    };
  }
}
