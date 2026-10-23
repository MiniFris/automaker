import { createTestProviderRegistry } from '../../helpers/provider-registry.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAICompatibleEndpoint, ExecuteOptions } from '@automaker/types';
import { toDirectModelId } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { AgentService } from '@/services/agent-service.js';
import { AgentExecutor } from '@/services/agent-executor.js';
import { prepareDirectExecution } from '@/providers/openai-compatible/execution.js';
import { simpleQuery, streamingQuery } from '@/providers/simple-query-service.js';
import { getPhaseModelWithOverrides } from '@/lib/settings-helpers.js';
import { createEventEmitter } from '@/lib/events.js';
import { TypedEventBus } from '@/services/typed-event-bus.js';
import type { FeatureStateManager } from '@/services/feature-state-manager.js';
import type { PlanApprovalService } from '@/services/plan-approval-service.js';
import { PipelineOrchestrator } from '@/services/pipeline-orchestrator.js';
import { EnvironmentBindingStore } from '@/services/execution-environment/bindings.js';

type RequestBody = {
  model: string;
  messages: Array<{ role: string; content: string | null }>;
  tools?: Array<{ function: { name: string } }>;
};
describe.skipIf(process.platform !== 'linux')('direct provider / application integration', () => {
  let temporary: string;
  let root: string;
  let settings: SettingsService;
  let server: Server;
  let endpoint: OpenAICompatibleEndpoint;
  let requests: Array<{ body: RequestBody; auth?: string }>;
  let handler: (body: RequestBody, res: ServerResponse) => void;
  const model = toDirectModelId('Vendor/ExactCase:Tag');
  const finish = (res: ServerResponse, content = 'Completed once') => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      })
    );
  };
  const call = (res: ServerResponse, name: string, args: unknown, id = 'local-call') => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
    );
  };
  beforeEach(async () => {
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-app-test-'));
    root = path.join(temporary, 'project');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'answer.txt'), '41');
    settings = new SettingsService(path.join(temporary, 'data'));
    requests = [];
    handler = (_body, res) => finish(res);
    server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body: RequestBody = JSON.parse(Buffer.concat(chunks).toString());
        requests.push({ body, auth: req.headers.authorization });
        handler(body, res);
      })().catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    endpoint = {
      id: 'first',
      name: 'First',
      enabled: true,
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      protocol: 'chat-completions',
      auth: { type: 'credentials', credentialId: 'first' },
      models: [
        {
          id: 'Vendor/ExactCase:Tag',
          displayName: 'Exact',
          capabilities: { tools: true, streaming: false },
        },
      ],
    };
    await settings.updateGlobalSettings({
      openaiCompatibleEndpoints: [
        endpoint,
        {
          ...endpoint,
          id: 'second',
          name: 'Second',
          auth: { type: 'credentials', credentialId: 'second' },
        },
      ],
    });
    await settings.updateCredentials({
      openaiCompatibleApiKeys: { first: 'first-private-key', second: 'second-private-key' },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const options = (): ExecuteOptions => ({
    prompt: 'Answer',
    cwd: root,
    model: 'Vendor/ExactCase:Tag',
    maxTurns: 10000,
  });

  it('routes simpleQuery explicitly between endpoints with identical opaque model IDs', async () => {
    for (const providerId of ['first', 'second'])
      expect(
        (
          await simpleQuery(
            {
              prompt: 'Text',
              model,
              providerId,
              settingsService: settings,
              cwd: root,
            },
            createTestProviderRegistry(settings)
          )
        ).text
      ).toBe('Completed once');
    expect(requests.map((request) => request.auth)).toEqual([
      'Bearer first-private-key',
      'Bearer second-private-key',
    ]);
    expect(requests.map((request) => request.body.model)).toEqual([
      'Vendor/ExactCase:Tag',
      'Vendor/ExactCase:Tag',
    ]);
    expect(requests.every((request) => !request.body.tools?.length)).toBe(true);
  });

  it('never chooses a direct endpoint by model alone and never falls back to Claude', async () => {
    await expect(
      simpleQuery(
        { prompt: 'Text', model, settingsService: settings, cwd: root },
        createTestProviderRegistry(settings)
      )
    ).rejects.toThrow('providerId');
    await expect(
      simpleQuery(
        {
          prompt: 'Text',
          model,
          providerId: 'missing',
          settingsService: settings,
          cwd: root,
        },
        createTestProviderRegistry(settings)
      )
    ).rejects.toThrow('providerId');
    expect(requests).toHaveLength(0);
  });

  it('revalidates a disabled endpoint and removed model at execution time', async () => {
    await settings.updateGlobalSettings({
      openaiCompatibleEndpoints: [{ ...endpoint, enabled: false }],
    });
    await expect(
      prepareDirectExecution(options(), settings, { model, providerId: 'first' })
    ).rejects.toThrow('disabled');
    await settings.updateGlobalSettings({
      openaiCompatibleEndpoints: [{ ...endpoint, models: [] }],
    });
    await expect(
      prepareDirectExecution(options(), settings, { model, providerId: 'first' })
    ).rejects.toThrow('not configured');
    expect(requests).toHaveLength(0);
  });

  it('replaces request-supplied runtime grants and secrets with server policy', async () => {
    const prepared = await prepareDirectExecution(
      {
        ...options(),
        openaiCompatibleAgent: { access: 'full-access' },
        sdkSessionId: 'old-sdk-session',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Actual system prompt' },
        mcpServers: { shouldNotBeUsed: { command: 'unsafe' } },
      },
      settings,
      { model, providerId: 'first' }
    );
    expect(prepared.model).toBe('Vendor/ExactCase:Tag');
    expect(prepared.maxTurns).toBe(100);
    expect(prepared.systemPrompt).toBe('Actual system prompt');
    expect(prepared.openaiCompatibleAgent?.access).toBe('read-only');
    expect(prepared.sdkSessionId).toBeUndefined();
    expect(prepared.mcpServers).toBeUndefined();
  });

  it('leaves other providers unchanged without reading direct settings', async () => {
    const legacy = { ...options(), model: 'claude-sonnet' };
    expect(await prepareDirectExecution(legacy, null, { model: 'claude-sonnet' })).toBe(legacy);
  });

  it('captures shared timeout settings for non-Direct text helpers without enabling tools', async () => {
    await settings.updateGlobalSettings({
      modelTimeouts: { cliIdleTimeoutMs: 600_000, requestTimeoutMs: 300_000 },
    });
    const prepared = await prepareDirectExecution(
      { ...options(), model: 'claude-sonnet', tools: [] },
      settings,
      { model: 'claude-sonnet' },
      'text'
    );
    expect(prepared.modelTimeouts).toEqual({
      cliIdleTimeoutMs: 600_000,
      requestTimeoutMs: 300_000,
    });
    expect(prepared.tools).toEqual([]);
    expect(prepared.openaiCompatibleConnection).toBeUndefined();
  });

  it('uses the selected provider timeout record and retains endpoint precedence', async () => {
    await settings.updateGlobalSettings({
      modelTimeouts: { requestTimeoutMs: 1000, toolTimeoutMs: 1000 },
      providerModelTimeouts: {
        claude: { requestTimeoutMs: 2000 },
        'openai-compatible': { requestTimeoutMs: 3000, toolTimeoutMs: 4000 },
      },
      openaiCompatibleEndpoints: [{ ...endpoint, timeouts: { toolTimeoutMs: 5000 } }],
    });
    const native = await prepareDirectExecution(
      { ...options(), model: 'claude-sonnet' },
      settings,
      { model: 'claude-sonnet' },
      'text'
    );
    expect(native.modelTimeouts).toEqual({ requestTimeoutMs: 2000 });
    const direct = await prepareDirectExecution(options(), settings, {
      model,
      providerId: 'first',
    });
    expect(direct.openaiCompatibleConnection?.timeoutMs).toBe(3000);
    expect(direct.openaiCompatibleAgent?.limits?.toolTimeoutMs).toBe(5000);
  });

  it('applies endpoint then global timeouts ahead of legacy agent limits', async () => {
    await settings.updateGlobalSettings({
      modelTimeouts: { requestTimeoutMs: 180_000, agentTimeoutMs: 900_000, toolTimeoutMs: 120_000 },
      openaiCompatibleAgentSettings: { limits: { maxDurationMs: 60_000, toolTimeoutMs: 1000 } },
      openaiCompatibleEndpoints: [
        { ...endpoint, timeoutMs: 240_000, timeouts: { toolTimeoutMs: 180_000 } },
      ],
    });
    const prepared = await prepareDirectExecution(options(), settings, {
      model,
      providerId: 'first',
    });
    expect(prepared.openaiCompatibleConnection?.timeoutMs).toBe(240_000);
    expect(prepared.openaiCompatibleAgent?.limits).toMatchObject({
      maxDurationMs: 900_000,
      toolTimeoutMs: 180_000,
    });
    await settings.updateGlobalSettings({
      modelTimeouts: {},
      openaiCompatibleEndpoints: [endpoint],
    });
    const inherited = await prepareDirectExecution(options(), settings, {
      model,
      providerId: 'first',
    });
    expect(inherited.openaiCompatibleAgent?.limits).toMatchObject({
      maxDurationMs: 60_000,
      toolTimeoutMs: 1000,
    });
  });

  it('streams with a read-only tool allowlist and does not duplicate final text', async () => {
    handler = (_body, res) => {
      if (requests.length === 1) call(res, 'Read', { path: 'answer.txt' });
      else finish(res, 'The answer is 41');
    };
    const onText = vi.fn();
    const onToolUse = vi.fn();
    const result = await streamingQuery(
      {
        prompt: 'Read answer',
        cwd: root,
        model,
        providerId: 'first',
        settingsService: settings,
        readOnly: true,
        onText,
        onToolUse,
      },
      createTestProviderRegistry(settings)
    );
    expect(result.text).toBe('The answer is 41');
    expect(onText.mock.calls.flat().join('')).toBe('The answer is 41');
    expect(onToolUse).toHaveBeenCalledTimes(1);
    expect(requests[0].body.tools?.map((tool) => tool.function.name)).toEqual([
      'Read',
      'Glob',
      'Grep',
    ]);
    expect(requests[1].body.messages.at(-1)?.content).toContain('41');
  });

  it('resolves project phase overrides including the endpoint binding', async () => {
    await settings.updateGlobalSettings({
      phaseModels: { enhancementModel: { model, providerId: 'first' } } as never,
    });
    await settings.updateProjectSettings(root, {
      phaseModelOverrides: { enhancementModel: { model, providerId: 'second' } },
    });
    const phase = await getPhaseModelWithOverrides('enhancementModel', settings, root);
    expect(phase.isProjectOverride).toBe(true);
    expect(phase.phaseModel.providerId).toBe('second');
    await simpleQuery(
      {
        prompt: 'Text',
        cwd: root,
        ...phase.phaseModel,
        settingsService: settings,
      },
      createTestProviderRegistry(settings)
    );
    expect(requests[0].auth).toBe('Bearer second-private-key');
  });

  it('persists the chat model and endpoint and restores conversation after server restart', async () => {
    await fs.mkdir(path.join(root, '.automaker', 'context'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.automaker', 'context', 'CLAUDE.md'),
      'DIRECT_PROJECT_RULE: use the project conventions.'
    );
    const events = createEventEmitter();
    const emitted: unknown[] = [];
    events.subscribe((_type, data) => emitted.push(data));
    const first = new AgentService(
      settings.getDataDirectory(),
      events,
      settings,
      createTestProviderRegistry(settings)
    );
    await first.initialize();
    const session = await first.createSession('Direct chat', root, root, model, 'second');
    expect(
      (await first.sendMessage({ sessionId: session.id, message: 'First question' })).success
    ).toBe(true);
    const restarted = new AgentService(
      settings.getDataDirectory(),
      events,
      settings,
      createTestProviderRegistry(settings)
    );
    await restarted.initialize();
    expect(
      (await restarted.sendMessage({ sessionId: session.id, message: 'Follow up' })).success
    ).toBe(true);
    expect(requests.map((item) => item.auth)).toEqual([
      'Bearer second-private-key',
      'Bearer second-private-key',
    ]);
    expect(requests[1].body.messages.some((message) => message.content === 'First question')).toBe(
      true
    );
    expect(
      requests[0].body.messages.some(
        (message) => message.role === 'system' && message.content?.includes('DIRECT_PROJECT_RULE')
      )
    ).toBe(true);
    expect((await restarted.listSessions())[0]).toMatchObject({ model, providerId: 'second' });
    const contentEvents = emitted.filter((event) => (event as { type: string }).type === 'stream');
    expect(contentEvents).toHaveLength(2);
    expect(JSON.stringify(emitted)).not.toContain('second-private-key');
    const checkpoints = await fs.readdir(
      path.join(settings.getDataDirectory(), 'direct-agent-checkpoints')
    );
    expect(checkpoints.length).toBe(2);
    for (const checkpoint of checkpoints)
      expect(
        await fs.readFile(
          path.join(settings.getDataDirectory(), 'direct-agent-checkpoints', checkpoint),
          'utf8'
        )
      ).not.toContain('second-private-key');
  });

  it('binds queued prompts to the selected endpoint/model and reloads the queue after restart', async () => {
    const events = createEventEmitter();
    const service = new AgentService(
      settings.getDataDirectory(),
      events,
      settings,
      createTestProviderRegistry(settings)
    );
    await service.initialize();
    const session = await service.createSession('Queue', root, root, model, 'first');
    const queued = await service.addToQueue(session.id, { message: 'Queued' });
    expect(queued.queuedPrompt).toMatchObject({ model, providerId: 'first' });
    await service.setSessionModel(session.id, model, 'second');
    const restarted = new AgentService(
      settings.getDataDirectory(),
      events,
      settings,
      createTestProviderRegistry(settings)
    );
    expect((await restarted.getQueue(session.id)).queue?.[0]).toMatchObject({
      model,
      providerId: 'first',
    });
    await restarted.clearQueue(session.id);
  });

  it('runs Write through chat only with explicit server-granted workspace-write permission', async () => {
    await settings.updateGlobalSettings({
      openaiCompatibleAgentSettings: { access: 'workspace-write' },
    });
    handler = (_body, res) => {
      if (requests.length === 1)
        call(res, 'Write', {
          path: 'created.txt',
          content: 'created safely',
          expectedSha256: null,
        });
      else finish(res);
    };
    const events = createEventEmitter();
    const service = new AgentService(
      settings.getDataDirectory(),
      events,
      settings,
      createTestProviderRegistry(settings)
    );
    await service.initialize();
    const session = await service.createSession('Coding', root, root, model, 'first');
    expect(
      (await service.sendMessage({ sessionId: session.id, message: 'Create a file' })).success
    ).toBe(true);
    expect(await fs.readFile(path.join(root, 'created.txt'), 'utf8')).toBe('created safely');
  });

  it.each(['legacy', 'local'] as const)(
    'keeps %s planning read-only, waits for approval, then uses the pinned environment',
    async (runtime) => {
      await settings.updateGlobalSettings({
        openaiCompatibleAgentSettings: { access: 'workspace-write' },
      });
      if (runtime === 'local') await new EnvironmentBindingStore(settings).confirm(root);
      const events = createEventEmitter();
      const bus = new TypedEventBus(events);
      const state = {
        updateFeaturePlanSpec: vi.fn(),
        updateTaskStatus: vi.fn(),
      } as unknown as FeatureStateManager;
      const executor = new AgentExecutor(bus, state, {} as PlanApprovalService, settings);
      const waitForApproval = vi.fn(async () => {
        expect(requests[0].body.tools?.some((tool) => tool.function.name === 'Write')).toBe(false);
        await expect(fs.stat(path.join(root, 'approved.txt'))).rejects.toThrow();
        if (runtime === 'local')
          await settings.updateProjectSettings(root, { executionEnvironment: { mode: 'auto' } });
        return { approved: true };
      });
      handler = (_body, res) => {
        if (requests.length === 1) finish(res, 'Plan: create approved.txt\n[SPEC_GENERATED]');
        else if (requests.length === 2)
          call(res, 'Write', {
            path: 'approved.txt',
            content: 'after approval',
            expectedSha256: null,
          });
        else finish(res, '<summary>Created after approval</summary>');
      };
      const result = await executor.execute(
        {
          projectPath: root,
          workDir: root,
          featureId: 'planned-feature',
          prompt: 'Make a plan first',
          systemPrompt: 'PERSISTED_TASK_RULE',
          model,
          providerId: 'first',
          effectiveBareModel: endpoint.models[0].id,
          provider: createTestProviderRegistry(settings).providerForModel(model),
          abortController: new AbortController(),
          planningMode: 'spec',
          requirePlanApproval: true,
        },
        {
          waitForApproval,
          saveFeatureSummary: vi.fn(),
          updateFeatureSummary: vi.fn(),
          buildTaskPrompt: vi.fn(() => 'Execute approved task'),
        }
      );
      expect(result.aborted).toBe(false);
      expect(waitForApproval).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(path.join(root, 'approved.txt'), 'utf8')).toBe('after approval');
      const output = await fs.readFile(
        path.join(root, '.automaker/features/planned-feature/agent-output.md'),
        'utf8'
      );
      expect(output.match(/## Tool results/g)).toHaveLength(1);
      expect(output).toContain('"ok":true');
      expect(output).not.toContain('first-private-key');
      expect(requests.every((request) => request.auth === 'Bearer first-private-key')).toBe(true);
      expect(
        requests.every((request) =>
          request.body.messages.some(
            (message) => message.role === 'system' && message.content === 'PERSISTED_TASK_RULE'
          )
        )
      ).toBe(true);
    }
  );

  it('does not report the same chat failure twice when the HTTP route handles its rejection', async () => {
    const events = createEventEmitter();
    const emitted: unknown[] = [];
    events.subscribe((_type, event) => emitted.push(event));
    const service = new AgentService(
      settings.getDataDirectory(),
      events,
      settings,
      createTestProviderRegistry(settings)
    );
    await service.initialize();
    const session = await service.createSession('Invalid selection', root, root, model, 'missing');
    const failure = await service
      .sendMessage({ sessionId: session.id, message: 'Do not fall back' })
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    service.emitSessionError(session.id, (failure as Error).message, failure);
    expect(emitted.filter((event) => (event as { type: string }).type === 'error')).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('resumes persisted approved tasks with their endpoint, without running completed tasks again', async () => {
    await settings.updateGlobalSettings({
      openaiCompatibleAgentSettings: { access: 'workspace-write' },
    });
    handler = (_body, res) => {
      if (requests.length === 1)
        call(res, 'Write', { path: 'resumed.txt', content: 'resumed', expectedSha256: null });
      else finish(res, '<summary>Resumed task completed</summary>');
    };
    const events = createEventEmitter();
    const executor = new AgentExecutor(
      new TypedEventBus(events),
      {
        updateFeaturePlanSpec: vi.fn(),
        updateTaskStatus: vi.fn(),
      } as unknown as FeatureStateManager,
      {} as PlanApprovalService,
      settings
    );
    const waitForApproval = vi.fn();
    const buildTaskPrompt = vi.fn(() => 'Execute the pending task');
    const result = await executor.execute(
      {
        projectPath: root,
        workDir: root,
        featureId: 'resumed-feature',
        prompt: 'Resume',
        model,
        providerId: 'second',
        effectiveBareModel: endpoint.models[0].id,
        provider: createTestProviderRegistry(settings).providerForModel(model),
        abortController: new AbortController(),
        existingApprovedPlanContent: 'Previously approved plan',
        persistedTasks: [
          { id: 'T001', description: 'Already done', status: 'completed' },
          { id: 'T002', description: 'Pending task', status: 'pending' },
        ] as never,
        planningMode: 'spec',
        requirePlanApproval: true,
      },
      {
        waitForApproval,
        buildTaskPrompt,
        saveFeatureSummary: vi.fn(),
        updateFeatureSummary: vi.fn(),
      }
    );
    expect(waitForApproval).not.toHaveBeenCalled();
    expect(buildTaskPrompt).toHaveBeenCalledTimes(1);
    expect(result.tasksCompleted).toBe(2);
    expect(await fs.readFile(path.join(root, 'resumed.txt'), 'utf8')).toBe('resumed');
    expect(requests.every((request) => request.auth === 'Bearer second-private-key')).toBe(true);
  });

  it('routes a pipeline step through AgentExecutor to the selected direct endpoint', async () => {
    const events = createEventEmitter();
    const bus = new TypedEventBus(events);
    const state = {
      updateFeaturePlanSpec: vi.fn(),
      updateTaskStatus: vi.fn(),
    } as unknown as FeatureStateManager;
    const executor = new AgentExecutor(bus, state, {} as PlanApprovalService, settings);
    handler = (_body, res) => finish(res, '<summary>Pipeline complete</summary>');
    const routed = vi.fn(
      async (
        workDir,
        featureId,
        prompt,
        abortController,
        projectPath,
        _images,
        routedModel,
        controls
      ) => {
        await executor.execute(
          {
            workDir,
            featureId,
            prompt,
            abortController,
            projectPath,
            model: routedModel,
            providerId: controls.providerId,
            effectiveBareModel: endpoint.models[0].id,
            provider: createTestProviderRegistry(settings).providerForModel(routedModel),
            status: controls.status,
            systemPrompt: controls.systemPrompt,
          },
          {
            waitForApproval: vi.fn(),
            saveFeatureSummary: vi.fn(),
            updateFeatureSummary: vi.fn(),
            buildTaskPrompt: vi.fn(() => 'Task'),
          }
        );
      }
    );
    const pipeline = new PipelineOrchestrator(
      bus,
      state,
      executor,
      {} as never,
      {} as never,
      {} as never,
      settings,
      vi.fn(),
      vi.fn(async () => ({ files: [], formattedPrompt: '' })),
      vi.fn(() => 'Feature implementation'),
      vi.fn(),
      routed
    );
    await pipeline.executePipeline({
      projectPath: root,
      featureId: 'pipeline-feature',
      feature: {
        id: 'pipeline-feature',
        title: 'Feature',
        description: 'Review the project',
        model,
        providerId: 'second',
      } as never,
      steps: [
        {
          id: 'review',
          name: 'Review',
          instructions: 'Inspect and summarize',
          order: 0,
          colorClass: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
      workDir: root,
      worktreePath: null,
      branchName: null,
      abortController: new AbortController(),
      autoLoadClaudeMd: true,
      testAttempts: 0,
      maxTestAttempts: 1,
    });
    expect(routed).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      auth: 'Bearer second-private-key',
      body: { model: 'Vendor/ExactCase:Tag' },
    });
  });

  it('requires server confirmation before any model request when Local is explicitly selected', async () => {
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      skipSandboxWarning: true,
    });
    await expect(
      prepareDirectExecution(
        { model: endpoint.models[0].id, prompt: 'Work', cwd: root },
        settings,
        { model, providerId: 'first' }
      )
    ).rejects.toThrow('explicit server-side');
    expect(requests).toHaveLength(0);
  });

  it('runs binary file tools and a real local shell through the mock model without Docker', async () => {
    await new EnvironmentBindingStore(settings).confirm(root);
    handler = (_body, res) => {
      if (requests.length === 1)
        call(
          res,
          'Write',
          { path: 'node_modules/pkg/data.bin', content: 'AP8BAg==', encoding: 'base64' },
          'binary'
        );
      else if (requests.length === 2)
        call(
          res,
          'Bash',
          {
            command:
              'test -f node_modules/pkg/data.bin && printf 42 > result.txt && rm node_modules/pkg/data.bin',
          },
          'command'
        );
      else if (requests.length === 3) call(res, 'Read', { path: 'result.txt' }, 'read-result');
      else finish(res, 'Local workflow finished');
    };
    const prepared = await prepareDirectExecution(
      { model: endpoint.models[0].id, prompt: 'Work locally', cwd: root },
      settings,
      { model, providerId: 'first' }
    );
    const messages = [];
    for await (const message of createTestProviderRegistry(settings)
      .providerForModel(model)
      .executeQuery(prepared))
      messages.push(message);
    expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
    expect(await fs.readFile(path.join(root, 'result.txt'), 'utf8')).toBe('42');
    await expect(fs.stat(path.join(root, 'node_modules/pkg/data.bin'))).rejects.toThrow();
    expect(requests[0].body.tools?.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(['Bash', 'Write', 'Delete', 'Mkdir'])
    );
  });

  it('does not expose shell or writes in Local read-only planning', async () => {
    await new EnvironmentBindingStore(settings).confirm(root);
    const prepared = await prepareDirectExecution(
      { model: endpoint.models[0].id, prompt: 'Plan only', cwd: root, readOnly: true },
      settings,
      { model, providerId: 'first' }
    );
    for await (const _message of createTestProviderRegistry(settings)
      .providerForModel(model)
      .executeQuery(prepared)) {
      /* drain */
    }
    expect(requests[0].body.tools?.map((tool) => tool.function.name)).toEqual([
      'Read',
      'LS',
      'Glob',
      'Grep',
      'TodoWrite',
    ]);
  });
  it('rejects a JSON-shaped runtime grant before contacting the model', async () => {
    await new EnvironmentBindingStore(settings).confirm(root);
    const prepared = await prepareDirectExecution(
      { model: endpoint.models[0].id, prompt: 'Work', cwd: root },
      settings,
      { model, providerId: 'first' }
    );
    const messages = [];
    for await (const message of createTestProviderRegistry(settings)
      .providerForModel(model)
      .executeQuery({
        ...prepared,
        executionEnvironmentRuntime: { type: 'local', cwd: root, capabilities: { shell: true } },
      }))
      messages.push(message);
    expect(messages.at(-1)).toMatchObject({ type: 'result', subtype: 'error_during_execution' });
    expect(requests).toHaveLength(0);
  });

  it('restores a pinned Local chat after restart without switching to a new global Docker selection', async () => {
    await new EnvironmentBindingStore(settings).confirm(root);
    const first = new AgentService(
      settings.getDataDirectory(),
      createEventEmitter(),
      settings,
      createTestProviderRegistry(settings)
    );
    await first.initialize();
    const session = await first.createSession('Pinned Local', root, root, model, 'first');
    await first.sendMessage({
      sessionId: session.id,
      message: 'First local turn',
      model,
      workingDirectory: root,
      providerId: 'first',
    });
    const original = (await first.listSessions()).find(
      (item) => item.id === session.id
    )!.executionEnvironment;
    expect(original?.type).toBe('local');
    await settings.updateProjectSettings(root, { executionEnvironment: { mode: 'auto' } });
    const restarted = new AgentService(
      settings.getDataDirectory(),
      createEventEmitter(),
      settings,
      createTestProviderRegistry(settings)
    );
    await restarted.initialize();
    await restarted.sendMessage({ sessionId: session.id, message: 'Continue pinned chat' });
    expect(
      (await restarted.listSessions()).find((item) => item.id === session.id)!.executionEnvironment
    ).toEqual(original);
    expect(requests).toHaveLength(2);
  });

  function testPipeline() {
    const hostRunner = { startTests: vi.fn() };
    const pipeline = new PipelineOrchestrator(
      new TypedEventBus(createEventEmitter()),
      {} as never,
      {} as never,
      hostRunner as never,
      {} as never,
      {} as never,
      settings,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    );
    const context = {
      projectPath: root,
      featureId: 'sandbox-tests',
      feature: { id: 'sandbox-tests', model, providerId: 'first' },
      workDir: root,
      abortController: new AbortController(),
      maxTestAttempts: 1,
    } as never;
    return { pipeline, hostRunner, context };
  }

  it('fails closed rather than running direct pipeline tests on the host without a sandbox', async () => {
    const { pipeline, hostRunner, context } = testPipeline();
    expect(await pipeline.executeTestStep(context, 'must-not-run-on-host')).toMatchObject({
      success: false,
      testsPassed: false,
      message: expect.stringContaining('Host execution is disabled'),
    });
    expect(hostRunner.startTests).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it('uses the confirmed Local backend for direct pipeline tests, not the legacy test runner', async () => {
    await new EnvironmentBindingStore(settings).confirm(root);
    const { pipeline, hostRunner, context } = testPipeline();
    expect(await pipeline.executeTestStep(context, 'test "$(cat answer.txt)" = "41"')).toEqual({
      success: true,
      testsPassed: true,
    });
    expect(hostRunner.startTests).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it.skipIf(!process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE)(
    'executes automatic direct pipeline tests only inside the configured real Docker sandbox',
    async () => {
      await settings.updateGlobalSettings({
        openaiCompatibleAgentSettings: {
          access: 'workspace-write',
          shell: { backend: 'docker', image: process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE! },
        },
      });
      const { pipeline, hostRunner, context } = testPipeline();
      expect(await pipeline.executeTestStep(context, 'test "$(cat answer.txt)" = "41"')).toEqual({
        success: true,
        testsPassed: true,
      });
      expect(hostRunner.startTests).not.toHaveBeenCalled();
      expect(requests).toHaveLength(0);
    },
    20_000
  );
});
