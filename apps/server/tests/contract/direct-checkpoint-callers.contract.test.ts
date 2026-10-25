import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { DirectAgentCheckpoint, ExecuteOptions } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import * as directExecution from '../../src/providers/openai-compatible/execution.js';
import { DirectCheckpointRepository } from '../../src/modules/providers/direct-checkpoint.repository.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { SimpleContextQueryAdapter } from '../../src/modules/context/simple-context-query.adapter.js';
import {
  PROMPT_QUERY,
  type PromptQuery,
} from '../../src/modules/prompt-enhancement/prompt-query.port.js';
import { PlanningWorkflowContext } from '../../src/modules/app-spec/planning-workflow.context.js';
import { NativeBacklogPlanWorkflow } from '../../src/modules/backlog-plan/native-backlog-plan.workflow.js';
import { IssueValidationService } from '../../src/modules/github/issue-validation.service.js';
import { IdeationService } from '../../src/services/ideation-service.js';
import { AgentEnvironmentPreparer } from '../../src/services/agent/agent-environment-preparer.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { AgentExecutor } from '../../src/services/agent-executor.js';
import type { AgentExecutionOptions } from '../../src/services/agent-executor-types.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ProviderMessage } from '../../src/providers/types.js';

class WiringProvider extends MockProvider {
  featureReply = false;
  protected override async *execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const properties = (
      options.outputFormat as { schema?: { properties?: Record<string, unknown> } } | undefined
    )?.schema?.properties;
    const result = properties?.verdict
      ? { verdict: 'valid', confidence: 'high', reasoning: 'Offline fixture', relatedFiles: [] }
      : { changes: [], summary: 'Offline fixture' };
    const text = this.featureReply
      ? `<summary>\n${'Explicit offline feature implementation evidence. '.repeat(12)}\n</summary>`
      : JSON.stringify(result);
    yield {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    };
    yield { type: 'result', subtype: 'success', result: text };
  }
}

const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
afterEach(async () => {
  try {
    await Promise.all(owners.splice(0).map((owner) => owner.app.close()));
  } finally {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-checkpoint-callers-'));
  roots.push(root);
  const claude = new WiringProvider('claude');
  const direct = new WiringProvider('openai-compatible');
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [
      { name: 'claude', create: () => claude },
      { name: 'openai-compatible', create: () => direct },
    ],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: root, LOG_LEVEL: 'error' },
  });
  owners.push(owner);
  return {
    ...owner,
    root,
    repository: owner.app.get(DirectCheckpointRepository),
    providers: owner.app.get(ProviderRegistry),
    settings: owner.app.get(SettingsService),
    direct,
    claude,
  };
}

it('passes the native repository through query, planning, ideation, issue validation, chat and feature execution callers', async () => {
  const owner = await fixture();
  const prepare = vi.spyOn(directExecution, 'prepareDirectExecution');
  const options = { prompt: 'offline fixture', model: 'claude-sonnet', cwd: owner.root };
  const check = async (label: string, action: () => unknown | Promise<unknown>) => {
    prepare.mockClear();
    await action();
    await vi.waitFor(() => expect(prepare, label).toHaveBeenCalled());
    for (const call of prepare.mock.calls) expect(call[5], label).toBe(owner.repository);
  };
  await check('context', () => owner.app.get(SimpleContextQueryAdapter).execute(options));
  await check('prompt', () => owner.app.get<PromptQuery>(PROMPT_QUERY)(options));
  await check('app-spec planning', () =>
    owner.app
      .get(PlanningWorkflowContext)
      .operation(owner.root, new AbortController().signal)
      .query(options, owner.providers)
  );
  await check('backlog', () =>
    owner.app.get(NativeBacklogPlanWorkflow).generate(
      {
        projectPath: owner.root,
        prompt: 'offline backlog',
        model: 'claude-sonnet',
        branchName: 'main',
      },
      new AbortController()
    )
  );
  const ideation = owner.app.get(IdeationService);
  const session = await ideation.startSession(owner.root);
  await check('ideation', () =>
    ideation.sendMessage(session.id, 'offline ideation', { model: 'claude-sonnet' })
  );
  const prompt = ideation.getAllPrompts()[0];
  await check('ideation suggestions', () =>
    ideation.generateSuggestions(owner.root, prompt.id, prompt.category, 1)
  );
  const issue = owner.app.get(IssueValidationService);
  await check('issue validation', () =>
    issue.start({
      projectPath: owner.root,
      issueNumber: 1,
      issueTitle: 'Offline',
      issueBody: 'fixture',
      model: 'claude-sonnet',
    })
  );
  await vi.waitFor(() =>
    expect(issue.status({ projectPath: owner.root, issueNumber: 1 })).toMatchObject({
      isRunning: false,
    })
  );
  await check('chat environment', () =>
    owner.app.get(AgentEnvironmentPreparer).prepare({
      options: { ...options, abortController: new AbortController() },
      settings: owner.settings,
      selection: {
        model: 'claude-sonnet',
        projectPath: owner.root,
        runKey: 'chat-checkpoint-fixture',
      },
      managedContext: false,
      onBinding: async () => {},
    })
  );
  await owner.app.get(FeatureLoader).create(owner.root, {
    id: 'checkpoint-feature',
    title: 'Checkpoint',
    description: 'fixture',
    status: 'backlog',
    model: 'claude-sonnet',
    planningMode: 'skip',
    skipTests: true,
  });
  owner.claude.featureReply = true;
  const execute = vi.spyOn(AgentExecutor.prototype, 'execute');
  const facade = owner.app.get(AutoModeServiceCompat).createFacade(owner.root);
  await check('feature execute', () => facade.executeFeature('checkpoint-feature', false, false));
  const executor = execute.mock.contexts[0];
  expect(executor).toBeInstanceOf(AgentExecutor);
  const execution: AgentExecutionOptions = {
    workDir: owner.root,
    featureId: 'checkpoint-feature',
    projectPath: owner.root,
    prompt: 'offline execution',
    model: 'claude-sonnet',
    effectiveBareModel: 'claude-sonnet',
    abortController: new AbortController(),
    provider: owner.providers.providerForModel('claude-sonnet'),
    planningMode: 'skip',
  };
  await check('feature continuation', () =>
    (
      executor as unknown as {
        buildExecOpts(
          options: AgentExecutionOptions,
          prompt: string,
          turns: number
        ): Promise<ExecuteOptions>;
      }
    ).buildExecOpts(execution, 'offline continuation', 1)
  );
});

it('binds actual Direct checkpoint callbacks to the correct native repository in two applications', async () => {
  const one = await fixture(),
    two = await fixture();
  expect(one.repository).not.toBe(two.repository);
  for (const owner of [one, two]) {
    await owner.settings.updateGlobalSettings({
      openaiCompatibleEndpoints: [
        {
          id: 'offline',
          name: 'Offline',
          enabled: true,
          baseUrl: 'http://127.0.0.1:9/v1',
          protocol: 'chat-completions',
          auth: { type: 'none' },
          models: [
            {
              id: 'Fixture/Exact',
              displayName: 'Fixture',
              capabilities: { tools: false, streaming: false },
            },
          ],
        },
      ],
    });
    const save = vi.spyOn(owner.repository, 'save');
    let prepared: ExecuteOptions | undefined;
    const execute = owner.direct.executeQuery.bind(owner.direct);
    vi.spyOn(owner.direct, 'executeQuery').mockImplementation((options) => {
      prepared = options;
      return execute(options);
    });
    await owner.app.get(SimpleContextQueryAdapter).execute({
      prompt: 'offline Direct',
      model: 'direct-Fixture/Exact',
      providerId: 'offline',
      settingsService: owner.settings,
      cwd: owner.root,
    });
    const checkpoint: DirectAgentCheckpoint = {
      version: 1,
      sessionId: randomUUID(),
      endpointId: 'offline',
      modelId: 'Fixture/Exact',
      workspace: owner.root,
      requestHash: 'a'.repeat(64),
      tools: [],
      status: 'completed',
      turns: 1,
      toolCalls: 0,
      outputChars: 0,
      elapsedMs: 1,
      messages: [{ role: 'user', content: 'fixture' }],
    };
    expect(prepared?.openaiCompatibleAgent?.onCheckpoint).toBeTypeOf('function');
    await prepared!.openaiCompatibleAgent!.onCheckpoint!(checkpoint);
    expect(save).toHaveBeenCalledOnce();
    expect(await owner.repository.load(checkpoint.sessionId)).toEqual(checkpoint);
    const sibling = owner === one ? two : one;
    await expect(sibling.repository.load(checkpoint.sessionId)).rejects.toThrow();
  }
});
