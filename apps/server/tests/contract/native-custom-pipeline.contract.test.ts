import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import WebSocket from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import {
  toDirectModelId,
  type ExecuteOptions,
  type Feature,
  type PipelineStep,
} from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { MockProvider } from '../helpers/mock-provider.js';

const exec = promisify(execFile);
const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
const sockets: WebSocket[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  sockets.splice(0).forEach((socket) => socket.terminate());
  const closed = await Promise.allSettled(owners.splice(0).map((owner) => owner.app.close()));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
const step = (id: string, order: number): PipelineStep => ({
  id,
  name: `Step ${id}`,
  instructions: `NATIVE_INSTRUCTIONS_${id}`,
  order,
  colorClass: 'blue',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
});
async function fixture(
  control?: (stage: string, options: ExecuteOptions, index: number) => Promise<void>
) {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_SYSTEM', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_TERMINAL_PROMPT', '0');
  vi.stubEnv('GIT_CONFIG_COUNT', '0');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-custom-pipeline-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const calls: Array<{ stage: string; options: ExecuteOptions }> = [];
  class OfflineProvider extends MockProvider {
    protected async *execute(options: ExecuteOptions) {
      const prompt =
        typeof options.prompt === 'string' ? options.prompt : JSON.stringify(options.prompt);
      const stage = /^## Pipeline Step: Step ([^\n]+)/m.exec(prompt)?.[1] ?? 'implementation';
      const index = calls.push({ stage, options });
      await control?.(stage, options, index);
      yield {
        type: 'assistant' as const,
        message: {
          role: 'assistant' as const,
          content: [
            {
              type: 'text' as const,
              text: `<summary>\n## ${stage}\n${`NATIVE_RESULT_${stage} explicit offline implementation details. `.repeat(12)}\n</summary>`,
            },
          ],
        },
      };
      yield { type: 'result' as const, subtype: 'success' as const };
    }
  }
  const owner = await createNestApplication({
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    host: '127.0.0.1',
    port: 0,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [
      { name: 'openai-compatible', create: () => new OfflineProvider('openai-compatible') },
    ],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
      AUTOMAKER_API_KEY: 'pipeline-fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  owners.push(owner);
  await owner.start();
  const origin = `http://127.0.0.1:${owner.app.getHttpServer().address().port}`;
  const post = async (route: string, body: object, method = 'POST') => {
    const response = await fetch(origin + '/api/' + route, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': 'pipeline-fixture' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result;
  };
  await post(
    'settings/global',
    {
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
              id: 'fixture',
              displayName: 'Fixture',
              capabilities: { tools: true, streaming: false, reasoning: true },
            },
          ],
        },
      ],
    },
    'PUT'
  );
  const socket = new WebSocket(
    origin.replace('http:', 'ws:') + '/api/events?apiKey=pipeline-fixture'
  );
  sockets.push(socket);
  const events: Array<Record<string, unknown>> = [];
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'auto-mode:event') events.push(frame.payload);
  });
  await once(socket, 'open');
  const runtime = owner.app.get(AutoModeServiceCompat);
  const manager = runtime.getGlobalService().getSharedServices().concurrencyManager;
  const feature = async (id: string, extra: Partial<Feature> = {}) =>
    (
      await post('features/create', {
        projectPath: project,
        feature: {
          id,
          title: 'Native custom pipeline',
          description: 'Explicit offline fixture',
          model: toDirectModelId('fixture'),
          providerId: 'offline',
          status: 'backlog',
          planningMode: 'skip',
          skipTests: true,
          thinkingLevel: 'high',
          reasoningEffort: 'high',
          ...extra,
        },
      })
    ).feature as Feature;
  const read = async (id: string) =>
    (await post('features/get', { projectPath: project, featureId: id })).feature as Feature;
  const config = async (steps: PipelineStep[]) =>
    post('pipeline/config/save', {
      projectPath: project,
      config: { version: 1, steps, retainedExtension: { key: 'opaque' } },
    });
  const idle = async (id: string, status = 'waiting_approval') => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (!manager.isRunning(id) && (await read(id)).status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Native pipeline did not finish: ${JSON.stringify({ feature: await read(id), stages: calls.map((call) => call.stage) })}`
    );
  };
  return { root, project, owner, post, events, calls, feature, read, config, idle, manager };
}

it('executes two ordered custom steps through HTTP, preserves excluded/opaque config and publishes actual WS events and summaries', async () => {
  const f = await fixture();
  await fs.mkdir(path.join(f.project, '.automaker/context'), { recursive: true });
  await fs.writeFile(path.join(f.project, '.automaker/context/rules.md'), 'NATIVE_CUSTOM_CONTEXT');
  await f.config([
    step('late', 2),
    step('excluded', 1),
    { ...step('early', 0), kind: 'test', testCommand: 'MUST_NOT_DISPATCH' } as PipelineStep,
  ]);
  const feature = await f.feature('ordered', { excludedPipelineSteps: ['excluded'] });
  expect(
    await f.post('auto-mode/run-feature', { projectPath: f.project, featureId: feature.id })
  ).toEqual({ success: true });
  await f.idle(feature.id);
  expect(f.calls.map((call) => call.stage)).toEqual(['implementation', 'early', 'late']);
  for (const call of f.calls) {
    expect(call.options.openaiCompatibleConnection?.endpointId).toBe('offline');
    expect(call.options.thinkingLevel).toBe('high');
    expect(call.options.reasoningEffort).toBe('high');
  }
  expect(String(f.calls[1].options.prompt)).toContain('NATIVE_RESULT_implementation');
  expect(String(f.calls[2].options.prompt)).toContain('NATIVE_RESULT_early');
  expect(JSON.stringify(f.calls[1].options.systemPrompt)).toContain('NATIVE_CUSTOM_CONTEXT');
  const finished = await f.read(feature.id);
  expect(finished.summary).toContain('### Step early');
  expect(finished.summary).toContain('### Step late');
  const wire = await f.post('pipeline/config', { projectPath: f.project });
  expect(wire.config.retainedExtension).toEqual({ key: 'opaque' });
  expect(wire.config.steps.find((value: PipelineStep) => value.id === 'early')).toMatchObject({
    kind: 'test',
    testCommand: 'MUST_NOT_DISPATCH',
  });
  for (const type of ['pipeline_step_started', 'pipeline_step_complete']) {
    const deadline = Date.now() + 3000;
    while (f.events.filter((event) => event.type === type).length < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.events.filter((event) => event.type === type).map((event) => event.stepId)).toEqual([
      'early',
      'late',
    ]);
  }
});

it('resumes a saved custom step through HTTP and completes removed/excluded stages without inventing a generic test command', async () => {
  const f = await fixture();
  await f.config([step('early', 0), step('late', 1)]);
  const feature = await f.feature('resume', { status: 'pipeline_late' });
  const output = path.join(f.project, '.automaker/features', feature.id, 'agent-output.md');
  await fs.writeFile(output, 'NATIVE_SAVED_PREVIOUS_CONTEXT');
  await f.post('auto-mode/resume-feature', { projectPath: f.project, featureId: feature.id });
  await f.idle(feature.id);
  expect(f.calls.map((call) => call.stage)).toEqual(['late']);
  expect(String(f.calls[0].options.prompt)).toContain('NATIVE_SAVED_PREVIOUS_CONTEXT');
  await f.post('features/update', {
    projectPath: f.project,
    featureId: feature.id,
    updates: { status: 'pipeline_removed' },
  });
  await f.post('auto-mode/resume-feature', { projectPath: f.project, featureId: feature.id });
  await f.idle(feature.id);
  expect(f.calls).toHaveLength(1);
  await f.post('features/update', {
    projectPath: f.project,
    featureId: feature.id,
    updates: { status: 'pipeline_early', excludedPipelineSteps: ['early', 'late'] },
  });
  await f.post('auto-mode/resume-feature', { projectPath: f.project, featureId: feature.id });
  await f.idle(feature.id);
  expect(f.calls).toHaveLength(1);
});

it('keeps a resumed incarnation current when a stopped custom-step provider returns late', async () => {
  const oldEntered = gate(),
    oldRelease = gate(),
    newEntered = gate(),
    newRelease = gate();
  let earlyCalls = 0;
  const f = await fixture(async (stage) => {
    if (stage === 'early' && ++earlyCalls === 1) {
      oldEntered.release();
      await oldRelease.promise;
    }
    if (stage === 'late') {
      newEntered.release();
      await newRelease.promise;
    }
  });
  await f.config([step('early', 0), step('late', 1)]);
  const feature = await f.feature('stop-resume');
  await f.post('auto-mode/run-feature', { projectPath: f.project, featureId: feature.id });
  await oldEntered.promise;
  const previous = f.manager.getRunningFeature(feature.id)!;
  expect(await f.post('auto-mode/stop-feature', { featureId: feature.id })).toMatchObject({
    success: true,
    stopped: true,
  });
  await f.post('auto-mode/resume-feature', { projectPath: f.project, featureId: feature.id });
  await newEntered.promise;
  const current = f.manager.getRunningFeature(feature.id)!;
  expect(current).not.toBe(previous);
  oldRelease.release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(f.manager.getRunningFeature(feature.id)).toBe(current);
  expect((await f.read(feature.id)).status).toBe('pipeline_late');
  expect(
    f.events.filter((event) => event.type === 'pipeline_step_complete' && event.stepId === 'early')
  ).toHaveLength(1);
  newRelease.release();
  await f.idle(feature.id);
  expect(
    f.events.filter((event) => event.type === 'pipeline_step_complete' && event.stepId === 'late')
  ).toHaveLength(1);
});

it.each([false, true])(
  'runs real Local merge after HTTP custom steps and preserves conflict/review status (conflict=%s)',
  async (conflict) => {
    const f = await fixture();
    const git = (...args: string[]) => exec('/usr/bin/git', ['-C', f.project, ...args]);
    await git('init', '-qb', 'main');
    await git('config', 'user.name', 'Fixture');
    await git('config', 'user.email', 'fixture@example.invalid');
    await fs.writeFile(path.join(f.project, '.gitignore'), '.automaker/\n.worktrees/\n');
    await fs.writeFile(path.join(f.project, 'source.txt'), 'base');
    await git('add', '.');
    await git('commit', '-qm', 'base');
    const worktree = path.join(f.project, '.worktrees', 'native-feature');
    await git('worktree', 'add', '-qb', 'native-feature', worktree, 'main');
    await fs.writeFile(path.join(worktree, 'feature-result.txt'), 'real branch result');
    if (conflict)
      await fs.writeFile(path.join(worktree, 'source.txt'), 'feature conflicting content');
    await exec('/usr/bin/git', ['-C', worktree, 'add', '.']);
    await exec('/usr/bin/git', ['-C', worktree, 'commit', '-qm', 'feature']);
    const expected = (await git('rev-parse', 'native-feature')).stdout.trim();
    if (conflict) {
      await fs.writeFile(path.join(f.project, 'source.txt'), 'main conflicting content');
      await git('add', 'source.txt');
      await git('commit', '-qm', 'main change');
    }
    const previousHead = (await git('rev-parse', 'HEAD')).stdout.trim();
    await f.config([step('early', 0), step('late', 1)]);
    const feature = await f.feature('merge', { branchName: 'native-feature' });
    await f.post('auto-mode/run-feature', {
      projectPath: f.project,
      featureId: feature.id,
      useWorktrees: true,
    });
    await f.idle(feature.id, conflict ? 'merge_conflict' : 'waiting_approval');
    expect((await git('rev-parse', 'HEAD')).stdout.trim()).toBe(conflict ? previousHead : expected);
    if (conflict) {
      expect((await f.read(feature.id)).status).toBe('merge_conflict');
      expect(f.events.some((event) => event.type === 'pipeline_merge_conflict')).toBe(true);
    }
    expect(await fs.readFile(path.join(f.project, 'feature-result.txt'), 'utf8')).toBe(
      'real branch result'
    );
    expect((await fs.stat(worktree)).isDirectory()).toBe(true);
    expect(f.calls.map((call) => call.stage)).toEqual(['implementation', 'early', 'late']);
    for (const call of f.calls) expect(call.options.cwd).toBe(worktree);
  }
);
