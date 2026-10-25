import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { PipelineApplicationService } from '../../src/modules/pipeline/pipeline-application.service.js';

let root: string, project: string, runtime: Awaited<ReturnType<typeof createNestApplication>>;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-pipeline-wire-'));
  project = path.join(root, 'project');
  await mkdir(project);
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      USERPROFILE: root,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'pipeline-fixture',
    },
  });
  await runtime.start();
});
afterAll(async () => {
  await runtime?.app.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function post(route: string, body: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/pipeline/${route}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'pipeline-fixture' },
      body: JSON.stringify(body),
    }
  );
  return { status: response.status, body: await response.json() };
}
const step = {
  id: 'step1',
  name: 'Step 1',
  order: 0,
  instructions: 'Instructions',
  colorClass: 'blue',
  createdAt: 'historical creation',
  updatedAt: 'historical update',
  extension: { retained: true },
};
const config = { version: 1, steps: [step], extension: null };
const operations = [
  {
    route: 'config',
    method: 'getPipelineConfig',
    app: 'get',
    input: {},
    args: () => [project],
    value: config,
    body: { success: true, config },
  },
  {
    route: 'config/save',
    method: 'savePipelineConfig',
    app: 'save',
    input: { config },
    args: () => [project, config],
    value: undefined,
    body: { success: true },
  },
  {
    route: 'steps/add',
    method: 'addStep',
    app: 'add',
    input: {
      step: {
        name: 'Step 1',
        order: 0,
        instructions: 'Instructions',
        colorClass: 'blue',
        extension: { retained: true },
      },
    },
    args: () => [
      project,
      {
        name: 'Step 1',
        order: 0,
        instructions: 'Instructions',
        colorClass: 'blue',
        extension: { retained: true },
      },
    ],
    value: step,
    body: { success: true, step },
  },
  {
    route: 'steps/update',
    method: 'updateStep',
    app: 'update',
    input: {
      stepId: 'step1',
      updates: { name: 'Updated Name', instructions: 'Updated instructions' },
    },
    args: () => [project, 'step1', { name: 'Updated Name', instructions: 'Updated instructions' }],
    value: { ...step, name: 'Updated Name', instructions: 'Updated instructions' },
    body: {
      success: true,
      step: { ...step, name: 'Updated Name', instructions: 'Updated instructions' },
    },
  },
  {
    route: 'steps/delete',
    method: 'deleteStep',
    app: 'delete',
    input: { stepId: 'step1' },
    args: () => [project, 'step1'],
    value: undefined,
    body: { success: true },
  },
  {
    route: 'steps/reorder',
    method: 'reorderSteps',
    app: 'reorder',
    input: { stepIds: ['step2', 'step1', 'step3'] },
    args: () => [project, ['step2', 'step1', 'step3']],
    value: undefined,
    body: { success: true },
  },
] as const;
it.each(operations)(
  'preserves native $route success data and application delegation',
  async (operation) => {
    const spy = vi
      .spyOn(runtime.app.get(PipelineService), operation.method)
      .mockResolvedValue(operation.value as never);
    const response = await post(operation.route, { projectPath: project, ...operation.input });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(operation.body);
    expect(spy).toHaveBeenCalledExactlyOnceWith(...operation.args());
  }
);
const invalid = [
  ['config', {}],
  ['config/save', { config }],
  ['config/save', { projectPath: 'PROJECT' }],
  ['steps/add', { step: { name: 'Step', order: 0, instructions: 'Do', colorClass: 'blue' } }],
  ['steps/add', { projectPath: 'PROJECT' }],
  [
    'steps/add',
    { projectPath: 'PROJECT', step: { order: 0, instructions: 'Do', colorClass: 'blue' } },
  ],
  ['steps/add', { projectPath: 'PROJECT', step: { name: 'Step', order: 0, colorClass: 'blue' } }],
  ['steps/update', { stepId: 'step1', updates: { name: 'New' } }],
  ['steps/update', { projectPath: 'PROJECT', updates: { name: 'New' } }],
  ['steps/update', { projectPath: 'PROJECT', stepId: 'step1' }],
  ['steps/update', { projectPath: 'PROJECT', stepId: 'step1', updates: {} }],
  ['steps/delete', { stepId: 'step1' }],
  ['steps/delete', { projectPath: 'PROJECT' }],
  ['steps/reorder', { stepIds: ['step1', 'step2'] }],
  ['steps/reorder', { projectPath: 'PROJECT' }],
  ['steps/reorder', { projectPath: 'PROJECT', stepIds: 'not-an-array' }],
] as const;
it.each(invalid)(
  'rejects malformed %s input before the pipeline application executes',
  async (route, input) => {
    const operation = operations.find((item) => item.route === route)!;
    const spy = vi.spyOn(runtime.app.get(PipelineService), operation.method);
    const body = { ...input, ...('projectPath' in input ? { projectPath: project } : {}) };
    const response = await post(route, body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      errorCode: 'VALIDATION_ERROR',
      error: expect.any(String),
    });
    expect(spy).not.toHaveBeenCalled();
  }
);
it.each(operations)(
  'propagates $route failure through the safe native exception filter',
  async (operation) => {
    vi.spyOn(runtime.app.get(PipelineService), operation.method).mockRejectedValue(
      new Error('private pipeline failure')
    );
    const response = await post(operation.route, { projectPath: project, ...operation.input });
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('private pipeline failure');
  }
);
it.each(operations)('rejects malformed $route application success payloads', async (operation) => {
  vi.spyOn(runtime.app.get(PipelineApplicationService), operation.app).mockResolvedValue({
    success: true,
    ...(operation.app === 'get'
      ? { config: null }
      : ['add', 'update'].includes(operation.app)
        ? { step: null }
        : { success: false }),
  } as never);
  const response = await post(operation.route, { projectPath: project, ...operation.input });
  expect(response.status).toBe(500);
  expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
});
it('round-trips native pipeline filesystem CRUD with extensible metadata and blocks corrupt-state mutation', async () => {
  expect((await post('config/save', { projectPath: project, config })).status).toBe(200);
  expect((await post('config', { projectPath: project })).body).toEqual({ success: true, config });
  const added = await post('steps/add', {
    projectPath: project,
    step: {
      name: 'New',
      order: -1,
      instructions: 'Run',
      colorClass: 'green',
      future: { kept: true },
    },
  });
  expect(added.status).toBe(200);
  expect(added.body.step).toMatchObject({ name: 'New', order: 0, future: { kept: true } });
  const id = added.body.step.id;
  const updated = await post('steps/update', {
    projectPath: project,
    stepId: id,
    updates: { name: 'Changed', future: { changed: true } },
  });
  expect(updated.status).toBe(200);
  expect(updated.body.step).toMatchObject({ id, name: 'Changed', future: { changed: true } });
  expect(
    (await post('steps/reorder', { projectPath: project, stepIds: ['step1', id] })).status
  ).toBe(200);
  expect((await post('steps/delete', { projectPath: project, stepId: id })).status).toBe(200);
  const saved = JSON.parse(
    await readFile(path.join(project, '.automaker', 'pipeline.json'), 'utf8')
  );
  expect(saved.steps.map((item: { id: string }) => item.id)).toEqual(['step1']);
  expect(saved.extension).toBeNull();
  const file = path.join(project, '.automaker', 'pipeline.json');
  for (const data of [
    '{broken',
    JSON.stringify({ version: 2, steps: [] }),
    JSON.stringify({ version: 1, steps: null }),
  ]) {
    await writeFile(file, data);
    const response = await post('steps/add', {
      projectPath: project,
      step: { name: 'Never', order: 0, instructions: 'Never', colorClass: 'red' },
    });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, errorCode: 'UNAVAILABLE' });
    expect(await readFile(file, 'utf8')).toBe(data);
  }
  expect((await post('config/save', { projectPath: project, config })).status).toBe(200);
});
