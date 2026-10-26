import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { ExecuteOptions } from '@automaker/types';
import { getIdeaPath, getIdeationSessionPath, getIdeationAnalysisPath } from '@automaker/platform';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';
import { AppSpecApplicationService } from '../../src/modules/app-spec/app-spec-application.service.js';
import {
  APP_SPEC_WORKFLOW_PORT,
  type AppSpecWorkflowPort,
} from '../../src/modules/app-spec/app-spec-workflow.port.js';
import { AppSpecJobRegistry } from '../../src/modules/app-spec/app-spec-job.registry.js';
import { BacklogPlanApplicationService } from '../../src/modules/backlog-plan/backlog-plan-application.service.js';
import {
  BACKLOG_PLAN_WORKFLOW,
  type BacklogPlanWorkflow,
} from '../../src/modules/backlog-plan/backlog-plan.ports.js';
import { IdeationApplicationService } from '../../src/modules/ideation/ideation-application.service.js';
import { IdeationService } from '../../src/services/ideation-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ProviderMessage } from '../../src/providers/types.js';
import * as planning from '@automaker/contracts/domains/planning-responses';
import * as ideation from '@automaker/contracts/domains/ideation-responses';

class OfflineProvider extends MockProvider {
  calls = 0;
  override async *executeQuery(_options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    this.calls++;
    yield {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '[{"title":"Offline suggestion","description":"Private fixture","priority":"legacy-priority","relatedFiles":null}]',
          },
        ],
      },
    };
    yield { type: 'result', subtype: 'success' };
  }
}
const provider = new OfflineProvider('claude');
let directory: string;
let project: string;
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let base: string;
const releases: Array<() => void> = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  releases.push(resolve);
  return { promise, resolve };
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-planning-response-'));
  project = path.join(directory, 'project');
  await mkdir(project);
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
    environment: {
      NODE_ENV: 'test',
      HOME: directory,
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: directory,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}/api/`;
});
afterAll(async () => {
  for (const release of releases) release();
  await runtime?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function call(route: string, body?: unknown, method = 'POST') {
  const response = await fetch(new URL(route, base), {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const post = (route: string, fields: Record<string, unknown> = {}) =>
  call(route, { projectPath: project, ...fields });
const status = (namespace: string) =>
  call(`${namespace}/status?projectPath=${encodeURIComponent(project)}`, undefined, 'GET');
async function write(file: string, value: unknown) {
  const fs = runtime.app.get<typeof Filesystem>(SECURE_FILESYSTEM);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}

it('covers every specification accepted/duplicate/status/stop wire while held jobs retain ownership until settled', async () => {
  const workflow = runtime.app.get<AppSpecWorkflowPort>(APP_SPEC_WORKFLOW_PORT);
  const rows = [
    {
      route: 'create',
      method: 'generate',
      type: 'spec_regeneration',
      input: { projectOverview: 'Owned overview' },
    },
    {
      route: 'generate',
      method: 'generate',
      type: 'spec_regeneration',
      input: { projectDefinition: 'Owned definition' },
    },
    {
      route: 'generate-features',
      method: 'generateFeatures',
      type: 'feature_generation',
      input: {},
    },
    { route: 'sync', method: 'sync', type: 'sync', input: {} },
  ];
  expect(
    planning.AppSpecStatusResponseSchema.parse((await status('spec-regeneration')).body)
  ).toMatchObject({ isRunning: false, projectPath: project });
  for (const row of rows) {
    const held = deferred();
    let signal: AbortSignal | undefined;
    const operation = vi
      .spyOn(workflow as never, row.method as never)
      .mockImplementation((...args: unknown[]) => {
        signal = (
          row.method === 'generate'
            ? (args[0] as { abortController: AbortController }).abortController
            : (args[row.method === 'generateFeatures' ? 2 : 1] as AbortController)
        ).signal;
        return held.promise;
      });
    try {
      const started = await post(`spec-regeneration/${row.route}`, row.input);
      expect(started.status).toBe(200);
      expect(planning.PlanningAcceptedResponseSchema.parse(started.body).success).toBe(true);
      const duplicate = await post(`spec-regeneration/${row.route}`, row.input);
      expect(duplicate.status).toBe(200);
      expect(planning.PlanningAcceptedResponseSchema.parse(duplicate.body)).toEqual({
        success: false,
        error: 'Operation already running for this project',
      });
      expect(
        planning.AppSpecStatusResponseSchema.parse((await status('spec-regeneration')).body)
      ).toMatchObject({ isRunning: true, type: row.type, startedAt: expect.any(String) });
      const global = await call('spec-regeneration/status', undefined, 'GET');
      expect(planning.AppSpecStatusResponseSchema.parse(global.body)).toEqual({
        success: true,
        isRunning: true,
      });
      const stopped = await call(
        'spec-regeneration/stop',
        row.route === 'sync' ? {} : { projectPath: project }
      );
      expect(stopped.status).toBe(200);
      planning.PlanningSuccessResponseSchema.parse(stopped.body);
      expect(signal?.aborted).toBe(true);
      expect((await status('spec-regeneration')).body.isRunning).toBe(true);
      held.resolve();
      await vi.waitFor(async () =>
        expect((await status('spec-regeneration')).body.isRunning).toBe(false)
      );
    } finally {
      held.resolve();
      operation.mockRestore();
    }
  }
});

it('covers backlog accepted/false/status/stop, extensible saved plan, apply labels and clear', async () => {
  const workflow = runtime.app.get<BacklogPlanWorkflow>(BACKLOG_PLAN_WORKFLOW);
  const held = deferred();
  let signal: AbortSignal | undefined;
  vi.spyOn(workflow, 'generate').mockImplementation(async (_input, controller) => {
    signal = controller.signal;
    await held.promise;
    return { changes: [], summary: 'Offline', dependencyUpdates: [] };
  });
  expect(
    planning.BacklogStatusResponseSchema.parse((await status('backlog-plan')).body).savedPlan
  ).toBeNull();
  let result = await post('backlog-plan/generate', { prompt: 'Owned backlog' });
  expect(result.status).toBe(200);
  expect(planning.PlanningAcceptedResponseSchema.parse(result.body).success).toBe(true);
  result = await post('backlog-plan/generate', { prompt: 'Duplicate' });
  expect(result.status).toBe(200);
  expect(planning.PlanningAcceptedResponseSchema.parse(result.body).success).toBe(false);
  expect(
    planning.BacklogStatusResponseSchema.parse((await status('backlog-plan')).body).isRunning
  ).toBe(true);
  result = await call('backlog-plan/stop');
  expect(result.status).toBe(200);
  planning.PlanningSuccessResponseSchema.parse(result.body);
  expect(signal?.aborted).toBe(true);
  expect((await status('backlog-plan')).body.isRunning).toBe(true);
  held.resolve();
  await vi.waitFor(async () => expect((await status('backlog-plan')).body.isRunning).toBe(false));
  const savedPlan = {
    savedAt: null,
    prompt: 4,
    model: null,
    extra: ['kept'],
    result: { changes: ['legacy row', { custom: true }], summary: null, dependencyUpdates: null },
  };
  await write(path.join(project, '.automaker/backlog-plan.json'), savedPlan);
  expect(
    planning.BacklogStatusResponseSchema.parse((await status('backlog-plan')).body).savedPlan
  ).toEqual(savedPlan);
  result = await post('backlog-plan/clear');
  expect(result.status).toBe(200);
  planning.PlanningSuccessResponseSchema.parse(result.body);
  const features = runtime.app.get(FeatureLoader);
  await features.create(project, { id: 'old', title: 'Old', description: 'Old' });
  await features.create(project, { id: 'update', title: 'Update', description: 'Update' });
  result = await post('backlog-plan/apply', {
    plan: {
      changes: [
        { type: 'delete', featureId: 'old' },
        {
          type: 'add',
          feature: { id: 'new : []', title: 'New', description: 'New', customData: { kept: true } },
        },
        { type: 'update', featureId: 'update', feature: { customUpdate: true } },
      ],
      dependencyUpdates: [],
      summary: 'Owned plan',
    },
  });
  expect(result.status).toBe(200);
  expect(planning.BacklogApplyResponseSchema.parse(result.body).appliedChanges).toEqual([
    'deleted:old',
    'added:new : []',
    'updated:update',
  ]);
  expect(await features.get(project, 'new : []')).toMatchObject({ customData: { kept: true } });
  expect(
    planning.BacklogStatusResponseSchema.parse((await status('backlog-plan')).body).savedPlan
  ).toBeNull();
});

it('covers native ideation session/idea/conversion/suggestion/prompt operations with an explicit offline provider', async () => {
  let response = await post('ideation/session/start', { options: { promptCategory: 'feature' } });
  expect(response.status).toBe(200);
  const sessionId = ideation.IdeationSessionStartResponseSchema.parse(response.body).session.id;
  response = await call('ideation/session/message', {
    sessionId,
    message: 'Offline message',
    options: { model: 'claude-mock-model' },
  });
  expect(response.status).toBe(200);
  ideation.IdeationSuccessResponseSchema.parse(response.body);
  const service = runtime.app.get(IdeationService);
  await vi.waitFor(() => expect(service.isSessionRunning(sessionId)).toBe(false));
  response = await post('ideation/session/get', { sessionId });
  expect(response.status).toBe(200);
  const session = ideation.IdeationSessionReadResponseSchema.parse(response.body);
  expect(session.messages.length).toBeGreaterThan(0);
  expect(session.session.isRunning).toBe(false);
  response = await call('ideation/session/stop', { sessionId });
  expect(response.status).toBe(200);
  ideation.IdeationSuccessResponseSchema.parse(response.body);
  response = await post('ideation/ideas/create', {
    idea: { title: 'Owned idea', description: 'Idea', category: 'feature' },
  });
  expect(response.status).toBe(200);
  const ideaId = ideation.IdeationIdeaResponseSchema.parse(response.body).idea.id;
  response = await post('ideation/ideas/list');
  expect(response.status).toBe(200);
  expect(ideation.IdeationIdeaListResponseSchema.parse(response.body).ideas).toContainEqual(
    expect.objectContaining({ id: ideaId })
  );
  response = await post('ideation/ideas/get', { ideaId });
  expect(response.status).toBe(200);
  ideation.IdeationIdeaResponseSchema.parse(response.body);
  response = await post('ideation/ideas/update', { ideaId, updates: { notes: 'Kept note' } });
  expect(response.status).toBe(200);
  expect(ideation.IdeationIdeaResponseSchema.parse(response.body).idea.notes).toBe('Kept note');
  response = await post('ideation/convert', { ideaId, keepIdea: true });
  expect(response.status).toBe(200);
  ideation.IdeationFeatureResponseSchema.parse(response.body);
  response = await post('ideation/ideas/delete', { ideaId });
  expect(response.status).toBe(200);
  ideation.IdeationSuccessResponseSchema.parse(response.body);
  response = await post('ideation/add-suggestion', {
    suggestion: { title: 'Suggestion feature', description: 'No model', category: 'feature' },
  });
  expect(response.status).toBe(200);
  ideation.IdeationFeatureResponseSchema.parse(response.body);
  response = await call('ideation/prompts', undefined, 'GET');
  expect(response.status).toBe(200);
  const catalog = ideation.IdeationPromptsResponseSchema.parse(response.body);
  expect(catalog.categories.length).toBeGreaterThan(0);
  response = await call(`ideation/prompts/${catalog.categories[0].id}`, undefined, 'GET');
  expect(response.status).toBe(200);
  ideation.IdeationCategoryPromptsResponseSchema.parse(response.body);
  response = await post('ideation/suggestions/generate', {
    promptId: 'feature-missing',
    category: 'feature',
    count: 1,
    contextSources: {
      useContextFiles: false,
      useMemoryFiles: false,
      useExistingFeatures: false,
      useExistingIdeas: false,
      useAppSpec: false,
    },
  });
  expect(response.status).toBe(200);
  expect(
    ideation.IdeationSuggestionsResponseSchema.parse(response.body).suggestions[0].priority
  ).toBe('legacy-priority');
  response = await post('ideation/analyze');
  expect(response.status).toBe(200);
  ideation.IdeationAnalysisAcceptedResponseSchema.parse(response.body);
  await vi.waitFor(async () => expect(await service.getCachedAnalysis(project)).not.toBeNull());
  response = await post('ideation/analysis');
  expect(response.status).toBe(200);
  expect(ideation.IdeationAnalysisResponseSchema.parse(response.body).result).not.toBeNull();
  expect(provider.calls).toBeGreaterThan(0);
});

it('preserves actual stored legacy idea/session/analysis fields including null timestamps and raw labels', async () => {
  const idea = {
    id: 'legacy-idea',
    title: { legacy: true },
    description: 'Kept',
    category: 'raw category',
    status: null,
    createdAt: 4,
    updatedAt: null,
    extra: ['kept'],
  };
  await write(getIdeaPath(project, 'legacy-idea'), idea);
  expect(
    ideation.IdeationIdeaResponseSchema.parse(
      (await post('ideation/ideas/get', { ideaId: 'legacy-idea' })).body
    ).idea
  ).toEqual(idea);
  expect(
    ideation.IdeationIdeaListResponseSchema.parse((await post('ideation/ideas/list')).body).ideas
  ).toContainEqual(idea);
  const messages = [
    { id: 4, role: 'legacy role', content: { raw: true }, timestamp: null, extra: true },
  ];
  const session = {
    id: 'legacy-session',
    projectPath: project,
    status: 'raw session label',
    createdAt: null,
    updatedAt: 4,
    extra: true,
  };
  await write(getIdeationSessionPath(project, 'legacy-session'), { session, messages });
  const read = ideation.IdeationSessionReadResponseSchema.parse(
    (await post('ideation/session/get', { sessionId: 'legacy-session' })).body
  );
  expect(read.session).toMatchObject(session);
  expect(read.messages).toEqual(messages);
  const result = { projectPath: project, analyzedAt: null, totalFiles: null, extra: ['legacy'] };
  await write(getIdeationAnalysisPath(project), result);
  expect(
    ideation.IdeationAnalysisResponseSchema.parse((await post('ideation/analysis')).body).result
  ).toEqual(result);
});

it('rejects malformed application successes for all 27 JSON handlers without hiding false accepted variants', async () => {
  const specs = runtime.app.get(AppSpecApplicationService);
  const plans = runtime.app.get(BacklogPlanApplicationService);
  const ideas = runtime.app.get(IdeationApplicationService);
  const matrix: Array<{
    route: string;
    owner: object;
    method: string;
    result: unknown;
    fields?: Record<string, unknown>;
    body?: unknown;
    get?: boolean;
  }> = [
    ...[
      { route: 'create', method: 'create', fields: { projectOverview: 'x' } },
      { route: 'generate', method: 'generate', fields: { projectDefinition: 'x' } },
      { route: 'generate-features', method: 'generateFeatures', fields: {} },
      { route: 'sync', method: 'sync', fields: {} },
    ].map((row) => ({
      ...row,
      route: 'spec-regeneration/' + row.route,
      owner: specs,
      result: { success: false },
    })),
    { route: 'spec-regeneration/stop', owner: specs, method: 'stop', result: { success: false } },
    {
      route: `spec-regeneration/status?projectPath=${encodeURIComponent(project)}`,
      owner: specs,
      method: 'status',
      result: { success: true, isRunning: 'yes' },
      get: true,
    },
    {
      route: 'backlog-plan/generate',
      owner: plans,
      method: 'generate',
      result: { success: false },
      fields: { prompt: 'x' },
    },
    {
      route: 'backlog-plan/stop',
      owner: plans,
      method: 'stop',
      result: { success: false },
      body: undefined,
    },
    {
      route: `backlog-plan/status?projectPath=${encodeURIComponent(project)}`,
      owner: plans,
      method: 'status',
      result: { success: true, isRunning: false, savedPlan: {} },
      get: true,
    },
    {
      route: 'backlog-plan/apply',
      owner: plans,
      method: 'apply',
      result: { success: true, appliedChanges: {} },
      fields: { plan: { changes: [] } },
    },
    { route: 'backlog-plan/clear', owner: plans, method: 'clear', result: { success: false } },
    {
      route: 'ideation/session/start',
      owner: ideas,
      method: 'startSession',
      result: { success: true, session: {} },
    },
    {
      route: 'ideation/session/message',
      owner: ideas,
      method: 'message',
      result: { success: false },
      body: { sessionId: 'opaque', message: 'x' },
    },
    {
      route: 'ideation/session/stop',
      owner: ideas,
      method: 'stopSession',
      result: { success: false },
      body: { sessionId: 'opaque' },
    },
    {
      route: 'ideation/session/get',
      owner: ideas,
      method: 'getSession',
      result: { success: true, session: { isRunning: false, messages: [] }, messages: {} },
      fields: { sessionId: 'opaque' },
    },
    {
      route: 'ideation/ideas/list',
      owner: ideas,
      method: 'listIdeas',
      result: { success: true, ideas: {} },
    },
    {
      route: 'ideation/ideas/create',
      owner: ideas,
      method: 'createIdea',
      result: { success: true, idea: [] },
      fields: { idea: { title: 'x', description: 'x', category: 'feature' } },
    },
    {
      route: 'ideation/ideas/get',
      owner: ideas,
      method: 'getIdea',
      result: { success: true, idea: null },
      fields: { ideaId: 'opaque' },
    },
    {
      route: 'ideation/ideas/update',
      owner: ideas,
      method: 'updateIdea',
      result: { success: true },
      fields: { ideaId: 'opaque', updates: { notes: 'x' } },
    },
    {
      route: 'ideation/ideas/delete',
      owner: ideas,
      method: 'deleteIdea',
      result: { success: false },
      fields: { ideaId: 'opaque' },
    },
    { route: 'ideation/analyze', owner: ideas, method: 'analyze', result: { success: true } },
    {
      route: 'ideation/analysis',
      owner: ideas,
      method: 'analysis',
      result: { success: true, result: [] },
    },
    {
      route: 'ideation/convert',
      owner: ideas,
      method: 'convert',
      result: { success: true, featureId: null },
      fields: { ideaId: 'opaque' },
    },
    {
      route: 'ideation/add-suggestion',
      owner: ideas,
      method: 'addSuggestion',
      result: { success: true },
      fields: { suggestion: { title: 'x', description: '', category: 'feature' } },
    },
    {
      route: 'ideation/prompts',
      owner: ideas,
      method: 'prompts',
      result: { success: true, prompts: [], categories: {} },
      get: true,
    },
    {
      route: 'ideation/prompts/feature',
      owner: ideas,
      method: 'promptsByCategory',
      result: { success: true, prompts: [{}] },
      get: true,
    },
    {
      route: 'ideation/suggestions/generate',
      owner: ideas,
      method: 'generateSuggestions',
      result: { success: true, suggestions: [{}] },
      fields: { promptId: 'feature-missing', category: 'feature' },
    },
  ];
  expect(matrix).toHaveLength(27);
  for (const entry of matrix) {
    const mocked = vi
      .spyOn(entry.owner as never, entry.method as never)
      .mockReturnValue(Promise.resolve(entry.result) as never);
    try {
      const response = entry.get
        ? await call(entry.route, undefined, 'GET')
        : entry.body !== undefined
          ? await call(entry.route, entry.body)
          : await post(entry.route, entry.fields);
      expect(response.status, entry.route).toBe(500);
      expect(response.body.error).toBe('Internal server error.');
    } finally {
      mocked.mockRestore();
    }
  }
});

it('keeps existing missing/invalid/storage/unavailable errors ahead of response parsing', async () => {
  expect((await post('ideation/ideas/get', { ideaId: 'missing' })).status).toBe(404);
  expect((await post('ideation/session/get', { sessionId: 'missing' })).status).toBe(404);
  expect((await call('ideation/prompts/unknown', undefined, 'GET')).status).toBe(400);
  const file = path.join(project, '.automaker/backlog-plan.json');
  await write(file, { result: { changes: null } });
  expect((await status('backlog-plan')).status).toBe(503);
  const fs = runtime.app.get<typeof Filesystem>(SECURE_FILESYSTEM);
  const original = fs.unlink.bind(fs);
  const unlink = vi
    .spyOn(fs, 'unlink')
    .mockImplementation((target) =>
      target === file
        ? Promise.reject(Object.assign(new Error('Owned EIO'), { code: 'EIO' }))
        : original(target)
    );
  const failed = await post('backlog-plan/clear');
  expect(failed.status).toBe(500);
  expect(failed.body.code).toBe('EIO');
  unlink.mockRestore();
  await runtime.app.get(AppSpecJobRegistry).onModuleDestroy();
  expect(
    (await post('spec-regeneration/generate', { projectDefinition: 'Unavailable' })).status
  ).toBe(503);
});
