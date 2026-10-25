import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { ApplicationMetrics } from '../../src/core/observability/application-metrics.js';
import { MockProvider } from '../helpers/mock-provider.js';

it('joins actual native HTTP feature/provider and verification command records without payload labels or cross-app metrics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-execution-correlation-'));
  const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const project = path.join(root, 'project'),
      bin = path.join(root, 'bin');
    await mkdir(project);
    await mkdir(bin);
    const commands = path.join(root, 'commands.jsonl');
    await writeFile(
      path.join(bin, 'npm'),
      `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(commands)}, JSON.stringify(process.argv.slice(2))+'\\n');
console.log('private-tool-output');
`,
      { mode: 0o700 }
    );
    for (const name of ['one', 'two']) {
      const app = await createNestApplication({
        workingDirectory: root,
        dataDir: path.join(root, name + '-data'),
        host: '127.0.0.1',
        port: 0,
        runStartupTasks: false,
        enableShutdownHooks: false,
        providerRegistrations: [{ name: 'claude', create: () => new MockProvider('claude') }],
        environment: {
          NODE_ENV: 'test',
          HOME: root,
          PATH: bin + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin',
          LOG_LEVEL: 'debug',
          LOG_COLORS: 'false',
          AUTOMAKER_API_KEY: 'feature-trace-fixture',
          ALLOWED_ROOT_DIRECTORY: root,
          ENABLE_REQUEST_LOGGING: 'false',
        },
      });
      applications.push(app);
      await app.start();
    }
    const one = applications[0].app,
      two = applications[1].app;
    const feature = await one.get(FeatureLoader).create(project, {
      id: 'trace-feature',
      title: 'Trace feature',
      description: 'private-prompt-content',
      model: 'claude-sonnet',
      status: 'backlog',
      skipTests: true,
      planningMode: 'skip',
      useWorktree: false,
    });
    const origin = 'http://127.0.0.1:' + one.getHttpServer().address().port;
    async function post(action: string, correlation: string) {
      const response = await fetch(origin + '/api/auto-mode/' + action, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'feature-trace-fixture',
          'x-request-id': correlation,
        },
        body: JSON.stringify({ projectPath: project, featureId: feature.id }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toBe(correlation);
      return response.json();
    }
    expect(await post('run-feature', 'feature-http-trace')).toMatchObject({ success: true });
    await vi.waitFor(async () => {
      expect((await one.get(FeatureLoader).get(project, feature.id))?.status).toBe(
        'waiting_approval'
      );
      expect(await one.get(AutoModeServiceCompat).isProjectRunning(project)).toBe(false);
    });
    expect(await post('verify-feature', 'verify-http-trace')).toMatchObject({ success: true });
    const records = output.mock.calls
      .filter(([prefix]) => String(prefix).includes('[Operations]'))
      .map(([, event, fields]) => ({ event, fields: fields as Record<string, unknown> }));
    const featureStart = records.find(
      (record) => record.event === 'operation started' && record.fields.kind === 'feature_execution'
    );
    expect(featureStart?.fields).toMatchObject({
      correlationId: 'feature-http-trace',
      featureId: feature.id,
    });
    const providerStart = records.find(
      (record) =>
        record.event === 'provider query started' &&
        record.fields.correlationId === 'feature-http-trace'
    );
    expect(providerStart?.fields.parentOperationId).toBe(featureStart?.fields.operationId);
    expect(
      records.some(
        (record) =>
          record.event === 'provider query settled' &&
          record.fields.operationId === providerStart?.fields.operationId
      )
    ).toBe(true);
    const executions = records.filter(
      (record) => record.event === 'operation started' && record.fields.kind === 'execution_command'
    );
    expect(executions).toHaveLength(4);
    expect(
      executions.every(
        (record) =>
          record.fields.correlationId === 'verify-http-trace' &&
          record.fields.featureId === feature.id &&
          record.fields.executionType === 'local'
      )
    ).toBe(true);
    expect(
      (await readFile(commands, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([['run', 'lint'], ['run', 'typecheck'], ['test'], ['run', 'build']]);
    expect(JSON.stringify(records)).not.toMatch(
      /private-prompt-content|private-tool-output|feature-trace-fixture|commands\.jsonl/
    );
    const snapshot = one.get(ApplicationMetrics).snapshot();
    expect(snapshot.counters).toContainEqual({
      name: 'operations_total',
      labels: { kind: 'execution_command', outcome: 'completed' },
      value: 4,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /trace-feature|feature-http-trace|verify-http-trace|private-prompt/
    );
    expect(
      two
        .get(ApplicationMetrics)
        .snapshot()
        .counters.some(
          (metric) =>
            metric.name === 'operations_total' &&
            ['feature_execution', 'execution_command'].includes(metric.labels.kind)
        )
    ).toBe(false);
  } finally {
    await Promise.all(applications.map((app) => app.app.close()));
    output.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it('observes an actual saved-ID MCP inspection with passive active/unknown gauges and the HTTP correlation', async () => {
  const { createNativeWorktreeHttp } = await import('../helpers/native-worktree-http.js');
  const { mcpHTTPPeer } = await import('../helpers/mcp-http-peer.js');
  const { MCPTestService } = await import('../../src/services/mcp-test-service.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-correlation-'));
  const peer = await mcpHTTPPeer('http', 'json');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const runtime = await createNativeWorktreeHttp({
    root,
    environment: { LOG_LEVEL: 'debug', LOG_COLORS: 'false' },
  });
  let release = () => {};
  try {
    await runtime.settings.updateGlobalSettings({
      mcpServers: [
        {
          id: 'private-server',
          name: 'Private',
          type: 'http',
          url: peer.url,
          headers: { Authorization: 'Bearer fixture-header-secret' },
        },
      ],
    });
    const original = runtime.settings.getGlobalSettings.bind(runtime.settings);
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi
      .spyOn(runtime.settings, 'getGlobalSettings')
      .mockImplementationOnce(async () => {
        await held;
        return original();
      });
    const response = fetch(runtime.url + '/api/mcp/tools', {
      method: 'POST',
      headers: {
        'x-api-key': runtime.apiKey,
        'content-type': 'application/json',
        'x-request-id': 'mcp-http-trace',
      },
      body: JSON.stringify({ serverId: 'private-server' }),
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    const metrics = runtime.app.get(ApplicationMetrics);
    expect(runtime.app.get(MCPTestService).activeOperationCount).toBe(1);
    expect(metrics.snapshot().runtimeGauges).toContainEqual({
      name: 'mcp_active_operations',
      value: 1,
    });
    expect(metrics.snapshot().runtimeGauges).toContainEqual({
      name: 'mcp_unconfirmed_operations',
      value: 0,
    });
    release();
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: true });
    expect(metrics.snapshot().runtimeGauges).toContainEqual({
      name: 'mcp_active_operations',
      value: 0,
    });
    expect(metrics.snapshot().counters).toContainEqual({
      name: 'operations_total',
      labels: { kind: 'mcp_inspection', outcome: 'completed' },
      value: 1,
    });
    const records = output.mock.calls
      .filter(([prefix]) => String(prefix).includes('[Operations]'))
      .map(([, event, fields]) => ({ event, fields: fields as Record<string, unknown> }));
    const operation = records.find(
      (record) => record.event === 'operation started' && record.fields.kind === 'mcp_inspection'
    );
    expect(operation?.fields.correlationId).toBe('mcp-http-trace');
    expect(
      records.some(
        (record) =>
          record.event === 'operation settled' &&
          record.fields.operationId === operation?.fields.operationId &&
          record.fields.outcome === 'completed'
      )
    ).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(
      /fixture-header-secret|private-server|127\.0\.0\.1/
    );
    expect(JSON.stringify(metrics.snapshot())).not.toMatch(
      /private-server|mcp-http-trace|fixture-header-secret/
    );
  } finally {
    release();
    vi.restoreAllMocks();
    await runtime.close();
    await peer.close();
    await rm(root, { recursive: true, force: true });
  }
});
