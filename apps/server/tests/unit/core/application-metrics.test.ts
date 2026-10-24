import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsSnapshotSchema } from '@automaker/contracts';
import { ApplicationMetrics } from '../../../src/core/observability/application-metrics.js';
import {
  RequestContextMiddleware,
  getCorrelationId,
  runWithCorrelationContext,
} from '../../../src/core/observability/request-context.js';
import {
  managedProviderStream,
  ProviderCleanupError,
  ProviderExecutionScope,
} from '../../../src/providers/provider-execution-scope.js';

const debug = vi.hoisted(() => vi.fn());
vi.mock('@automaker/utils', () => ({ createLogger: () => ({ debug }) }));

const options = { model: 'fixture', cwd: '/owned-fixture', prompt: 'private-prompt-fixture' };
async function collect(stream: AsyncGenerator<unknown>) {
  for await (const _value of stream) {
    /* Consume the owned iterator. */
  }
}
beforeEach(() => debug.mockClear());

describe('application metrics', () => {
  it('bounds aggregate cardinality and returns independent snapshots', () => {
    const metrics = new ApplicationMetrics();
    for (let index = 0; index < 2200; index++)
      metrics.increment('requests_total', { route: String(index) });
    const snapshot = metrics.snapshot();
    expect(snapshot.counters).toHaveLength(2032);
    expect(snapshot.droppedMeasurements).toBe(168);
    snapshot.counters[0].value = 999;
    snapshot.counters[0].labels.route = 'changed';
    expect(metrics.snapshot().counters[0]).toMatchObject({ value: 1, labels: { route: '0' } });
    expect(new ApplicationMetrics().snapshot().counters).toHaveLength(0);
    const finish = metrics.providerQueryStarted();
    finish({ failed: true, cancelled: false, unconfirmed: false });
    expect(metrics.snapshot().counters).toContainEqual({
      name: 'provider_errors_total',
      labels: { outcome: 'error' },
      value: 1,
    });
    expect(MetricsSnapshotSchema.safeParse(metrics.snapshot()).success).toBe(true);
  });

  it('uses fixed cumulative histogram buckets and rejects invalid measurements', () => {
    const metrics = new ApplicationMetrics();
    for (const value of [1, 5, 6]) metrics.observe('duration_ms', value);
    metrics.observe('duration_ms', Infinity);
    metrics.observe('duration_ms', -1);
    metrics.increment('bad metric');
    const snapshot = metrics.snapshot();
    expect(snapshot.observations[0]).toMatchObject({ count: 3, sum: 12, min: 1, max: 6 });
    expect(snapshot.observations[0].buckets.slice(0, 3)).toEqual([
      { upperBound: 1, count: 1 },
      { upperBound: 5, count: 2 },
      { upperBound: 10, count: 3 },
    ]);
    expect(snapshot.droppedMeasurements).toBe(3);
  });

  it('records one completed HTTP response and never labels unmatched URLs with user input', () => {
    const metrics = new ApplicationMetrics();
    const middleware = new RequestContextMiddleware(metrics);
    const response = Object.assign(new EventEmitter(), {
      statusCode: 404,
      writableFinished: true,
      setHeader: vi.fn(),
    });
    const request = {
      header: () => 'request-fixture',
      method: 'GET',
      path: '/private-token-fixture?secret=hidden',
    };
    let correlation: string | undefined;
    middleware.use(request as never, response as never, () => {
      correlation = getCorrelationId();
    });
    response.emit('finish');
    response.emit('close');
    expect(correlation).toBe('request-fixture');
    expect(metrics.snapshot().counters).toEqual([
      {
        name: 'http_requests_total',
        value: 1,
        labels: { method: 'GET', route: 'unmatched', status: '404', outcome: 'completed' },
      },
    ]);
    expect(JSON.stringify(metrics.snapshot())).not.toContain('private-token');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private-token');
  });

  it('records a disconnected HTTP response once under its registered template', () => {
    const metrics = new ApplicationMetrics();
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
      setHeader: vi.fn(),
    });
    new RequestContextMiddleware(metrics).use(
      { header: () => undefined, method: 'GET', route: { path: '/api/sessions/:id' } } as never,
      response as never,
      () => undefined
    );
    response.emit('close');
    response.emit('finish');
    expect(metrics.snapshot().counters[0]).toMatchObject({
      value: 1,
      labels: { route: '/api/sessions/:id', outcome: 'aborted' },
    });
  });

  it('keeps provider traces correlated and per-application counts isolated', async () => {
    const first = new ApplicationMetrics(),
      second = new ApplicationMetrics();
    const run = (metrics: ApplicationMetrics, correlation: string) =>
      runWithCorrelationContext(correlation, () =>
        collect(
          managedProviderStream(
            options as never,
            async function* () {
              yield { type: 'text', text: 'private-output-fixture' } as never;
            },
            new ProviderExecutionScope(50, () => metrics.providerQueryStarted())
          )
        )
      );
    await Promise.all([run(first, 'request-A'), run(second, 'request-B')]);
    expect(first.snapshot().providerActiveQueries).toBe(0);
    expect(second.snapshot().providerActiveQueries).toBe(0);
    expect(first.snapshot().counters).toEqual([
      { name: 'provider_queries_total', labels: { outcome: 'completed' }, value: 1 },
    ]);
    const records = debug.mock.calls.map((call) => call[1]);
    expect(records.filter((record) => record.correlationId === 'request-A')).toHaveLength(2);
    expect(records.filter((record) => record.correlationId === 'request-B')).toHaveLength(2);
    expect(new Set(records.map((record) => record.operationId)).size).toBe(2);
    expect(JSON.stringify(records)).not.toContain('private-');
  });

  it('classifies real provider errors separately from the internal cleanup abort', async () => {
    const metrics = new ApplicationMetrics();
    const stream = managedProviderStream(
      options as never,
      async function* () {
        throw new Error('private-provider-error');
      },
      new ProviderExecutionScope(50, () => metrics.providerQueryStarted())
    );
    await expect(collect(stream)).rejects.toThrow('private-provider-error');
    expect(metrics.snapshot().counters).toContainEqual({
      name: 'provider_errors_total',
      labels: { outcome: 'error' },
      value: 1,
    });
    expect(metrics.snapshot().providerActiveQueries).toBe(0);
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private-provider-error');
  });

  it('retains an active query when iterator cleanup is unconfirmed', async () => {
    const metrics = new ApplicationMetrics();
    const scope = new ProviderExecutionScope(50, () => metrics.providerQueryStarted());
    const iterator = {
      next: async () => ({ done: false, value: { type: 'text' } }),
      return: async () => {
        throw new Error('private-cleanup-error');
      },
    };
    const stream = managedProviderStream(options as never, () => iterator as never, scope);
    await stream.next();
    await expect(stream.return(undefined)).rejects.toBeInstanceOf(ProviderCleanupError);
    expect(metrics.snapshot().providerActiveQueries).toBe(1);
    expect(metrics.snapshot().counters).toContainEqual({
      name: 'provider_errors_total',
      labels: { outcome: 'unknown' },
      value: 1,
    });
    await expect(scope.dispose()).rejects.toBeInstanceOf(ProviderCleanupError);
  });

  it('does not let a broken observer change the provider result', async () => {
    const scope = new ProviderExecutionScope(50, () => {
      throw new Error('telemetry fixture');
    });
    await expect(
      collect(
        managedProviderStream(
          options as never,
          async function* () {
            yield { type: 'text' } as never;
          },
          scope
        )
      )
    ).resolves.toBeUndefined();
    await expect(scope.dispose()).resolves.toBeUndefined();
  });
});
