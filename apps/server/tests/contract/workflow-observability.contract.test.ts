import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AgentService } from '../../src/services/agent-service.js';
import { AgentExecutionCoordinator } from '../../src/services/agent/agent-execution-coordinator.js';
import { ApplicationMetrics } from '../../src/core/observability/application-metrics.js';
import { getCorrelationId } from '../../src/core/observability/request-context.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions, ProviderMessage } from '../../src/providers/types.js';

it('joins native HTTP to an actual agent/provider workflow and exposes isolated passive runtime gauges', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-observability-'));
  const runtimes: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  let release = () => {};
  let observedCorrelation: string | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  class ObservedProvider extends MockProvider {
    protected async *execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
      observedCorrelation = getCorrelationId();
      const aborted = () => release();
      options.abortController?.signal.addEventListener('abort', aborted, { once: true });
      try {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'private fixture response' }],
          },
        };
        await held;
      } finally {
        options.abortController?.signal.removeEventListener('abort', aborted);
      }
    }
  }
  const provider = new ObservedProvider('claude');
  try {
    for (const name of ['first', 'second']) {
      const directory = path.join(root, name);
      await fs.mkdir(directory);
      const runtime = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory: directory,
        dataDir: path.join(directory, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        providerRegistrations: name === 'first' ? [{ name: 'claude', create: () => provider }] : [],
        environment: {
          NODE_ENV: 'test',
          HOME: directory,
          PATH: '/usr/bin:/bin',
          ALLOWED_ROOT_DIRECTORY: directory,
          AUTOMAKER_API_KEY: 'workflow-key',
        },
      });
      runtimes.push(runtime);
      await runtime.start();
    }
    const [first, second] = runtimes;
    const base = `http://127.0.0.1:${first.app.getHttpServer().address().port}/api/`;
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(base + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-api-key': 'workflow-key',
          'x-request-id': 'workflow-http-proof',
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const session = await first.app
      .get(AgentService)
      .createSession(
        'Telemetry fixture',
        path.join(root, 'first'),
        path.join(root, 'first'),
        'sonnet'
      );
    await request('agent/send', { sessionId: session.id, message: 'private fixture prompt' });
    await vi.waitFor(() => expect(observedCorrelation).toBe('workflow-http-proof'));
    const active = await request('metrics');
    const gauges = Object.fromEntries(
      active.runtimeGauges.map((entry: { name: string; value: number | null }) => [
        entry.name,
        entry.value,
      ])
    );
    expect(gauges.agent_executions).toBe(1);
    expect(active.providerActiveQueries).toBe(1);
    expect(gauges.local_dev_unknown_cleanup).toBe(0);
    expect(gauges.local_test_unknown_cleanup).toBe(0);
    await request('agent/queue/add', { sessionId: session.id, message: 'private queued prompt' });
    expect(first.app.get(ApplicationMetrics).snapshot().runtimeGauges).toContainEqual({
      name: 'loaded_session_queue_depth',
      value: 1,
    });
    await request('agent/queue/clear', { sessionId: session.id });
    expect(second.app.get(ApplicationMetrics).snapshot().runtimeGauges).toContainEqual({
      name: 'agent_executions',
      value: 0,
    });
    await request('agent/stop', { sessionId: session.id });
    await vi.waitFor(() => expect(first.app.get(AgentExecutionCoordinator).ids()).toHaveLength(0));
    const settled = await request('metrics');
    expect(settled.providerActiveQueries).toBe(0);
    expect(settled.runtimeGauges).toContainEqual({ name: 'agent_executions', value: 0 });
    expect(settled.runtimeGauges).toContainEqual({ name: 'loaded_session_queue_depth', value: 0 });
    expect(settled.counters).toContainEqual({
      name: 'operations_total',
      labels: { kind: 'agent_execution', outcome: 'cancelled' },
      value: 1,
    });
    expect(
      settled.observations.some(
        (item: { name: string }) => item.name === 'application_bootstrap_duration_ms'
      )
    ).toBe(true);
    expect(JSON.stringify(settled)).not.toMatch(
      /private fixture|private queued|workflow-http-proof/
    );
  } finally {
    release();
    for (const runtime of runtimes.reverse()) await runtime.app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
