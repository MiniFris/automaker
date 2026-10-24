import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-auto-native-'));
});
afterEach(async () => {
  const results = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string, provider?: MockProvider) {
  const project = path.join(root, name);
  await mkdir(project);
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, `${name}-data`),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: provider ? [{ name: 'claude', create: () => provider }] : [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  apps.push(owner);
  await owner.start();
  const port = (owner.app.getHttpServer().address() as { port: number }).port;
  return {
    ...owner,
    project,
    runtime: owner.app.get(AutoModeServiceCompat),
    post: async (route: string, body: object = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auto-mode/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

it('preserves all 17 endpoint success contracts, HTTP 200 and background acknowledgements', async () => {
  const owner = await start('parity'),
    runtime = owner.runtime;
  vi.spyOn(runtime, 'isAutoLoopRunningForProject').mockReturnValue(false);
  vi.spyOn(runtime, 'startAutoLoopForProject').mockResolvedValue(2);
  vi.spyOn(runtime, 'getStatusForProject').mockResolvedValue({
    isAutoLoopRunning: true,
    runningFeatures: [],
    runningCount: 0,
    maxConcurrency: 2,
    branchName: null,
  });
  vi.spyOn(runtime, 'stopFeature').mockResolvedValue(false);
  vi.spyOn(runtime, 'verifyFeature').mockResolvedValue(true);
  vi.spyOn(runtime, 'contextExists').mockResolvedValue(false);
  vi.spyOn(runtime, 'commitFeature').mockResolvedValue('fixture-commit');
  vi.spyOn(runtime, 'mergeEnvironmentFeature').mockResolvedValue(undefined);
  vi.spyOn(runtime, 'mergeSSHFeature').mockResolvedValue(undefined);
  vi.spyOn(runtime, 'analyzeProject').mockResolvedValue(undefined);
  vi.spyOn(runtime, 'followUpFeature').mockResolvedValue(undefined);
  vi.spyOn(runtime, 'resumeFeature').mockResolvedValue(undefined);
  vi.spyOn(runtime, 'resumeInterruptedFeatures').mockResolvedValue(undefined);
  vi.spyOn(runtime, 'reconcileFeatureStates').mockResolvedValue(1);
  vi.spyOn(runtime, 'getPendingPlanApproval').mockResolvedValue(null);
  vi.spyOn(runtime, 'resolvePlanApproval').mockResolvedValue({ success: true });
  let release!: () => void;
  const running = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.spyOn(runtime, 'executeFeature').mockReturnValue(running);
  const project = { projectPath: owner.project },
    feature = { ...project, featureId: 'fixture' };
  const cases: Array<[string, object, object]> = [
    ['merge-environment-feature', { ...feature, accepted: true }, { success: true }],
    ['merge-ssh-feature', { ...feature, accepted: true }, { success: true }],
    [
      'start',
      project,
      {
        success: true,
        branchName: null,
        message: 'Auto mode started with max 2 concurrent features',
      },
    ],
    ['stop', project, { success: true, wasRunning: false, branchName: null }],
    ['stop-feature', { featureId: 'fixture' }, { success: true, stopped: false }],
    [
      'status',
      project,
      {
        success: true,
        isRunning: false,
        isAutoLoopRunning: true,
        runningCount: 0,
        branchName: null,
      },
    ],
    ['run-feature', feature, { success: true }],
    ['resume-feature', feature, { success: true }],
    ['verify-feature', feature, { success: true, passes: true }],
    ['context-exists', feature, { success: true, exists: false }],
    ['analyze-project', project, { success: true, message: 'Project analysis started' }],
    ['follow-up-feature', { ...feature, prompt: 'Continue' }, { success: true }],
    ['commit-feature', feature, { success: true, commitHash: 'fixture-commit' }],
    [
      'approve-plan',
      { ...feature, approved: true, approvalToken: 'owned', approvalRunId: 'run', planVersion: 1 },
      { success: true, approved: true },
    ],
    ['pending-plan-approval', feature, { success: true, approval: null }],
    ['resume-interrupted', project, { success: true, message: 'Resume check completed' }],
    ['reconcile', project, { success: true, reconciledCount: 1 }],
  ];
  try {
    for (const [route, input, expected] of cases)
      expect(await owner.post(route, input), route).toMatchObject({ status: 200, body: expected });
    expect(execute).toHaveBeenCalledWith(owner.project, 'fixture', false, false);
    expect(await owner.post('run-feature', {})).toMatchObject({ status: 400 });
    expect(await owner.post('merge-ssh-feature', { ...feature, accepted: false })).toMatchObject({
      status: 400,
    });
  } finally {
    release();
  }
});

it.skipIf(process.platform === 'win32')(
  'shares canonical alias context, preserves stop/restart, and isolates applications',
  async () => {
    const first = await start('first'),
      second = await start('second');
    const alias = path.join(root, 'alias');
    await symlink(first.project, alias);
    expect(first.runtime.createFacade(first.project)).toBe(first.runtime.createFacade(alias));
    expect(first.runtime.createFacade(first.project)).not.toBe(
      second.runtime.createFacade(first.project)
    );
    const request = { projectPath: first.project, maxConcurrency: 1 };
    expect(await first.post('start', request)).toMatchObject({ status: 200 });
    expect(await first.post('start', { ...request, projectPath: alias })).toMatchObject({
      status: 200,
      body: { alreadyRunning: true },
    });
    expect(await first.post('stop', { projectPath: alias })).toMatchObject({
      status: 200,
      body: { runningFeaturesCount: 0 },
    });
    expect(await first.post('start', request)).toMatchObject({
      status: 200,
      body: { branchName: null },
    });
    expect(await second.post('status', { projectPath: first.project })).toMatchObject({
      status: 200,
      body: { isAutoLoopRunning: false },
    });
    await first.app.close();
    expect(await second.post('status', { projectPath: first.project })).toMatchObject({
      status: 200,
    });
  }
);

it('runs a real native feature through an offline provider after the immediate HTTP ack', async () => {
  const provider = new MockProvider('claude');
  const owner = await start('workflow', provider);
  const feature = await owner.app.get(FeatureLoader).create(owner.project, {
    id: 'owned-feature',
    title: 'Owned feature',
    description: 'Offline fixture only',
    model: 'claude-sonnet',
    status: 'backlog',
    skipTests: true,
    planningMode: 'skip',
    useWorktree: false,
  });
  expect(
    await owner.post('run-feature', { projectPath: owner.project, featureId: feature.id })
  ).toMatchObject({ status: 200, body: { success: true } });
  await vi.waitFor(async () => {
    const stored = await owner.app.get(FeatureLoader).get(owner.project, feature.id);
    expect(stored?.status).toBe('waiting_approval');
  });
});
