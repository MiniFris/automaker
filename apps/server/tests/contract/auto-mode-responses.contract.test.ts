import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { AutoModeApplicationService } from '../../src/modules/auto-mode/auto-mode-application.service.js';
let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-auto-native-'));
});
afterEach(async () => {
  const results = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string) {
  const project = path.join(root, name);
  await mkdir(project);
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, `${name}-data`),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
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

it('preserves global/scoped status, active stop, nullable commit, rejected approval and tickets', async () => {
  const owner = await start('variants'),
    runtime = owner.runtime;
  const project = { projectPath: owner.project },
    feature = { ...project, featureId: 'opaque' };
  vi.spyOn(runtime, 'isAutoLoopRunningForProject').mockReturnValue(true);
  vi.spyOn(runtime, 'stopAutoLoopForProject').mockResolvedValue(0);
  expect(await owner.post('start', { ...project, branchName: '' })).toMatchObject({
    status: 200,
    body: { alreadyRunning: true, branchName: '' },
  });
  expect(await owner.post('stop', project)).toMatchObject({
    status: 200,
    body: { runningFeaturesCount: 0, branchName: null },
  });
  vi.spyOn(runtime, 'getStatus').mockReturnValue({
    isRunning: true,
    runningFeatures: ['same', 'same'],
    runningCount: 2,
  });
  vi.spyOn(runtime, 'getActiveAutoLoopProjects').mockReturnValue([owner.project]);
  vi.spyOn(runtime, 'getActiveAutoLoopWorktrees').mockReturnValue([
    { projectPath: owner.project, branchName: null },
  ]);
  expect(await owner.post('status')).toMatchObject({
    status: 200,
    body: {
      runningFeatures: ['same', 'same'],
      runningCount: 2,
      activeAutoLoopWorktrees: [{ projectPath: owner.project, branchName: null }],
    },
  });
  vi.spyOn(runtime, 'getStatusForProject').mockResolvedValue({
    isAutoLoopRunning: true,
    runningFeatures: [],
    runningCount: 0,
    maxConcurrency: -0.5,
    branchName: null,
  });
  expect(await owner.post('status', project)).toMatchObject({
    status: 200,
    body: { isRunning: false, isAutoLoopRunning: true, maxConcurrency: -0.5 },
  });
  vi.spyOn(runtime, 'verifyFeature').mockResolvedValue(false);
  vi.spyOn(runtime, 'commitFeature').mockResolvedValue(null);
  expect(await owner.post('verify-feature', feature)).toEqual({
    status: 200,
    body: { success: true, passes: false },
  });
  expect(await owner.post('commit-feature', feature)).toEqual({
    status: 200,
    body: { success: true, commitHash: null },
  });
  const ticket = { approvalToken: 'token', approvalRunId: 'run', planVersion: 1, planContent: '' };
  vi.spyOn(runtime, 'resolvePlanApproval').mockResolvedValue({ success: true });
  vi.spyOn(runtime, 'getPendingPlanApproval').mockResolvedValue(ticket);
  expect(
    await owner.post('approve-plan', {
      ...feature,
      ...ticket,
      planContent: undefined,
      approved: false,
    })
  ).toMatchObject({ status: 200, body: { approved: false } });
  expect(await owner.post('pending-plan-approval', feature)).toEqual({
    status: 200,
    body: { success: true, approval: ticket },
  });
  vi.spyOn(runtime, 'reconcileFeatureStates').mockResolvedValue(0);
  expect(await owner.post('reconcile', project)).toEqual({
    status: 200,
    body: { success: true, reconciledCount: 0, message: 'No features needed reconciliation' },
  });
});

it('rejects malformed application success on all 17 HTTP operations', async () => {
  const owner = await start('malformed'),
    service = owner.app.get(AutoModeApplicationService);
  const project = { projectPath: owner.project },
    feature = { ...project, featureId: 'fixture' };
  const cases: Array<[string, keyof AutoModeApplicationService, object, object]> = [
    [
      'merge-environment-feature',
      'mergeFeature',
      { ...feature, accepted: true },
      { success: false },
    ],
    ['merge-ssh-feature', 'mergeFeature', { ...feature, accepted: true }, { success: false }],
    ['start', 'start', project, { success: true, message: 'x', branchName: 1 }],
    ['stop', 'stop', project, { success: true, message: 'x', branchName: null }],
    ['stop-feature', 'stopFeature', { featureId: 'fixture' }, { success: true, stopped: 'false' }],
    ['status', 'status', project, { success: true, isRunning: false }],
    ['run-feature', 'runFeature', feature, { success: false }],
    ['resume-feature', 'resumeFeature', feature, { success: false }],
    ['verify-feature', 'verifyFeature', feature, { success: true, passes: 'false' }],
    ['context-exists', 'contextExists', feature, { success: true, exists: null }],
    ['analyze-project', 'analyzeProject', project, { success: true }],
    [
      'follow-up-feature',
      'followUpFeature',
      { ...feature, prompt: 'continue' },
      { success: false },
    ],
    ['commit-feature', 'commitFeature', feature, { success: true, commitHash: 1 }],
    [
      'approve-plan',
      'approvePlan',
      { ...feature, approved: true, approvalToken: 't', approvalRunId: 'r', planVersion: 1 },
      { success: true, approved: true },
    ],
    ['pending-plan-approval', 'pendingPlanApproval', feature, { success: true, approval: {} }],
    ['resume-interrupted', 'resumeInterrupted', project, { success: true }],
    ['reconcile', 'reconcile', project, { success: true, reconciledCount: -1, message: 'x' }],
  ];
  for (const [route, method, input, result] of cases) {
    const spy = vi.spyOn(service, method).mockReturnValue(Promise.resolve(result) as never);
    try {
      expect(await owner.post(route, input), route).toMatchObject({
        status: 500,
        body: { success: false, error: 'Internal server error.' },
      });
    } finally {
      spy.mockRestore();
    }
  }
});

it('keeps request/path validation, merge HTTP 400 and approval conflict ahead of success parsing', async () => {
  const owner = await start('errors'),
    runtime = owner.runtime;
  const feature = { projectPath: owner.project, featureId: 'fixture' };
  const merge = vi
    .spyOn(runtime, 'mergeSSHFeature')
    .mockRejectedValue(new Error('merge fixture failure'));
  expect(await owner.post('merge-ssh-feature', { ...feature, accepted: false })).toMatchObject({
    status: 400,
  });
  expect(merge).not.toHaveBeenCalled();
  expect(await owner.post('merge-ssh-feature', { ...feature, accepted: true })).toMatchObject({
    status: 400,
    body: { success: false, error: 'merge fixture failure' },
  });
  vi.spyOn(runtime, 'resolvePlanApproval').mockResolvedValue({
    success: false,
    error: 'stale fixture ticket',
  });
  expect(
    await owner.post('approve-plan', {
      ...feature,
      approved: false,
      approvalToken: 't',
      approvalRunId: 'r',
      planVersion: 1,
    })
  ).toMatchObject({ status: 409, body: { success: false, error: 'stale fixture ticket' } });
  const service = owner.app.get(AutoModeApplicationService),
    status = vi.spyOn(service, 'status');
  expect(await owner.post('status', { projectPath: path.dirname(root) })).toMatchObject({
    status: 403,
  });
  expect(status).not.toHaveBeenCalled();
  runtime.closeAdmission();
  expect(await owner.post('run-feature', feature)).toMatchObject({
    status: 503,
    body: { success: false, error: 'Auto mode is shutting down.' },
  });
});
