import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { MetricsSnapshotSchema } from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { ApplicationMetrics } from '../../src/core/observability/application-metrics.js';
import { METRICS } from '../../src/core/observability/metrics.js';
import { getCorrelationId } from '../../src/core/observability/request-context.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions, ProviderMessage } from '../../src/providers/types.js';

it('protects bounded per-app metrics and carries the HTTP correlation into real provider execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-observability-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const observed: Array<{ owner: string; correlationId?: string }> = [];
  class ObservedProvider extends MockProvider {
    constructor(private readonly owner: string) {
      super('claude');
    }
    protected async *execute(_options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
      observed.push({ owner: this.owner, correlationId: getCorrelationId() });
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Enhanced fixture.' }] },
      };
    }
  }
  async function owner(name: string) {
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, name),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: path.join(root, 'config'),
        ALLOWED_ROOT_DIRECTORY: root,
        AUTOMAKER_API_KEY: 'metrics-fixture-key',
      },
      providerRegistrations: [
        { name: 'claude', canHandleModel: () => true, create: () => new ObservedProvider(name) },
      ],
    });
    apps.push(runtime);
    await runtime.start();
    const address = runtime.app.getHttpServer().address();
    return { runtime, url: `http://127.0.0.1:${address.port}` };
  }
  try {
    const first = await owner('first'),
      second = await owner('second');
    expect(first.runtime.app.get(METRICS)).toBe(first.runtime.app.get(ApplicationMetrics));
    expect(first.runtime.app.get(ApplicationMetrics)).not.toBe(
      second.runtime.app.get(ApplicationMetrics)
    );
    expect((await fetch(first.url + '/api/metrics')).status).toBe(401);
    const response = await fetch(first.url + '/api/enhance-prompt', {
      method: 'POST',
      headers: {
        'X-API-Key': 'metrics-fixture-key',
        'Content-Type': 'application/json',
        'X-Request-ID': 'trace-fixture',
      },
      body: JSON.stringify({ originalText: 'private-prompt-fixture', enhancementMode: 'improve' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('trace-fixture');
    expect(await response.json()).toMatchObject({
      success: true,
      enhancedText: 'Enhanced fixture.',
    });
    expect(observed).toEqual([{ owner: 'first', correlationId: 'trace-fixture' }]);
    const read = async (url: string) => {
      const response = await fetch(url + '/api/metrics', {
        headers: { 'X-API-Key': 'metrics-fixture-key' },
      });
      expect(response.status).toBe(200);
      return MetricsSnapshotSchema.parse(await response.json());
    };
    const firstMetrics = await read(first.url),
      secondMetrics = await read(second.url);
    expect(firstMetrics.providerActiveQueries).toBe(0);
    expect(firstMetrics.counters).toContainEqual({
      name: 'provider_queries_total',
      labels: { outcome: 'completed' },
      value: 1,
    });
    expect(firstMetrics.counters).toContainEqual(
      expect.objectContaining({
        name: 'http_requests_total',
        labels: expect.objectContaining({ route: '/api/enhance-prompt', status: '200' }),
      })
    );
    expect(
      secondMetrics.counters.some((counter) => counter.name === 'provider_queries_total')
    ).toBe(false);
    const serialized = JSON.stringify(firstMetrics);
    for (const secret of ['private-prompt-fixture', 'metrics-fixture-key', root, 'trace-fixture'])
      expect(serialized).not.toContain(secret);
  } finally {
    await Promise.all(apps.map((runtime) => runtime.app.close()));
    await rm(root, { recursive: true, force: true });
  }
});
