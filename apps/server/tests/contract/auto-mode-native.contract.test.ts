import { ProjectAnalysisService } from '../../src/modules/auto-mode/project-analysis.service.js';
import { mkdtemp, mkdir, rm, symlink, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { FeatureRunCoordinator } from '../../src/modules/orchestration/feature-run-coordinator.service.js';
import { ProjectRunContextRegistry } from '../../src/modules/auto-mode/project-run-context.registry.js';
import { LocalExecutionEnvironment } from '../../src/services/execution-environment/local.js';
import { ExecutionEnvironmentError } from '../../src/services/execution-environment/runtime.js';
import { FeatureWorkspaceService } from '../../src/services/execution-environment/feature-workspace.js';
import type { ExecuteOptions } from '@automaker/types';
import type { ProviderMessage } from '../../src/providers/types.js';

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
  vi.spyOn(owner.app.get(ProjectAnalysisService), 'launch').mockReturnValue(undefined);
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

it('keeps a restarted native run owned when the stopped provider completes late', async () => {
  vi.stubEnv('AUTOMAKER_DEBUG_RAW_OUTPUT', 'true');
  const releases: Array<() => void> = [];
  class DelayedProvider extends MockProvider {
    protected async *execute(_options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      releases.push(release);
      const label = releases.length === 1 ? 'old-A' : 'owned-B';
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: label }],
        },
      };
      await held;
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: label + ' late' }] },
      };
      yield { type: 'result', subtype: 'success' };
    }
  }
  const owner = await start('restart-workflow', new DelayedProvider('claude'));
  const loader = owner.app.get(FeatureLoader);
  const feature = await loader.create(owner.project, {
    id: 'restart-feature',
    title: 'Restart fixture',
    description: 'Offline fixture',
    model: 'claude-sonnet',
    status: 'backlog',
    skipTests: true,
    planningMode: 'skip',
    useWorktree: false,
  });
  const manager = owner.runtime.getGlobalService().getSharedServices().concurrencyManager;
  expect(manager.coordinator).toBe(owner.app.get(FeatureRunCoordinator));
  const run = () =>
    owner.post('run-feature', { projectPath: owner.project, featureId: feature.id });
  try {
    expect(await run()).toMatchObject({ status: 200 });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const first = manager.getRunningFeature(feature.id)!;
    expect(
      await owner.post('verify-feature', { projectPath: owner.project, featureId: feature.id })
    ).toMatchObject({ status: 409, body: { success: false } });
    expect(await owner.post('stop-feature', { featureId: feature.id })).toMatchObject({
      status: 200,
    });
    expect(await run()).toMatchObject({ status: 200 });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const second = manager.getRunningFeature(feature.id)!;
    expect(second.incarnation).not.toBe(first.incarnation);
    const outputPath = path.join(
      owner.project,
      '.automaker/features',
      feature.id,
      'agent-output.md'
    );
    const rawPath = path.join(owner.project, '.automaker/features', feature.id, 'raw-output.jsonl');
    await vi.waitFor(async () => expect(await readFile(outputPath, 'utf8')).toContain('owned-B'));
    await vi.waitFor(async () => expect(await readFile(rawPath, 'utf8')).toContain('owned-B'));
    const outputBeforeLate = await readFile(outputPath, 'utf8');
    const rawBeforeLate = await readFile(rawPath, 'utf8');
    // Drain the old accepted HTTP command, rather than relying on a sleep.
    const contexts = owner.app.get(ProjectRunContextRegistry);
    const all = (
      contexts as unknown as { contexts: Map<string, { pendingCommands: Set<Promise<unknown>> }> }
    ).contexts;
    const commands = [...all.values()].flatMap((context) => [...context.pendingCommands]);
    releases[0]();
    await commands[0];
    expect(manager.getRunningFeature(feature.id)).toBe(second);
    expect(await readFile(outputPath, 'utf8')).toBe(outputBeforeLate);
    expect(await readFile(rawPath, 'utf8')).toBe(rawBeforeLate);
    expect(second.model).toBe('claude-sonnet-4-6');
    expect(second.provider).toBe('claude');
    expect((await loader.get(owner.project, feature.id))?.status).toBe('in_progress');
    releases[1]();
    await vi.waitFor(async () =>
      expect((await loader.get(owner.project, feature.id))?.status).toBe('waiting_approval')
    );
  } finally {
    for (const release of releases) release();
  }
});

it('keeps plan approval distinct from final review in the native workflow', async () => {
  class ApprovalProvider extends MockProvider {
    private calls = 0;
    protected async *execute(): AsyncGenerator<ProviderMessage> {
      const text =
        ++this.calls === 1
          ? '## Fixture plan\nImplement the fixture.\n[SPEC_GENERATED]'
          : '<summary>Fixture implemented</summary>';
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      };
      yield { type: 'result', subtype: 'success' };
    }
  }
  const owner = await start('approval-workflow', new ApprovalProvider('claude'));
  const loader = owner.app.get(FeatureLoader);
  const feature = await loader.create(owner.project, {
    id: 'approval-feature',
    title: 'Approval fixture',
    description: 'Offline fixture',
    model: 'claude-sonnet',
    status: 'backlog',
    skipTests: true,
    planningMode: 'lite',
    requirePlanApproval: true,
    useWorktree: false,
  });
  const input = { projectPath: owner.project, featureId: feature.id };
  expect(await owner.post('run-feature', input)).toMatchObject({ status: 200 });
  const manager = owner.runtime.getGlobalService().getSharedServices().concurrencyManager;
  await vi.waitFor(() =>
    expect(manager.getRunningFeature(feature.id)?.state).toBe('awaiting_plan_approval')
  );
  const owned = manager.getRunningFeature(feature.id)!;
  const pending = await owner.post('pending-plan-approval', input);
  expect(pending).toMatchObject({
    status: 200,
    body: { success: true, approval: { planVersion: 1 } },
  });
  const { approvalToken, approvalRunId, planVersion } = pending.body.approval;
  expect(
    await owner.post('approve-plan', {
      ...input,
      approvalToken,
      approvalRunId,
      planVersion,
      approved: true,
    })
  ).toMatchObject({ status: 200, body: { success: true } });
  await vi.waitFor(async () =>
    expect((await loader.get(owner.project, feature.id))?.status).toBe('waiting_approval')
  );
  expect(owned.state).toBe('awaiting_review');
  expect((await loader.get(owner.project, feature.id))?.planSpec?.status).toBe('approved');
});

async function verificationFixture(name: string, hold = false, fail = false) {
  const owner = await start(name);
  await owner.app.get(FeatureLoader).create(owner.project, {
    id: 'verify-fixture',
    title: 'Verify fixture',
    description: 'Offline verification',
    model: 'claude-sonnet',
    status: 'waiting_approval',
  });
  await writeFile(
    path.join(owner.project, 'package.json'),
    JSON.stringify({
      scripts: Object.fromEntries(
        ['lint', 'typecheck', 'test', 'build'].map((command) => [
          command,
          `node verify.cjs ${command}`,
        ])
      ),
    })
  );
  await writeFile(
    path.join(owner.project, 'verify.cjs'),
    `const fs=require('node:fs');fs.appendFileSync('checks.jsonl',process.argv[2]+'\\n');if(${hold}&&process.argv[2]==='lint'){fs.writeFileSync('verification.pid',String(process.pid));setInterval(()=>{},1000)}else if(${fail})process.exit(1);`
  );
  return { ...owner, input: { projectPath: owner.project, featureId: 'verify-fixture' } };
}

it('runs the four existing verification commands under one testing lease and preserves the HTTP result', async () => {
  const owner = await verificationFixture('verification-checks');
  const manager = owner.runtime.getGlobalService().getSharedServices().concurrencyManager;
  const verifying = owner.post('verify-feature', owner.input);
  await vi.waitFor(() =>
    expect(manager.getRunningFeature(owner.input.featureId)?.state).toBe('testing')
  );
  const lease = manager.getRunningFeature(owner.input.featureId)!;
  expect(await verifying).toEqual({ status: 200, body: { success: true, passes: true } });
  expect(
    (await readFile(path.join(owner.project, 'checks.jsonl'), 'utf8')).trim().split('\n')
  ).toEqual(['lint', 'typecheck', 'test', 'build']);
  expect(lease.state).toBe('awaiting_review');
  expect(lease.completedEvents.has('verification-complete')).toBe(true);
  expect(manager.getRunningFeature(owner.input.featureId)).toBeUndefined();
  expect(
    (await owner.app.get(FeatureLoader).get(owner.project, owner.input.featureId))?.status
  ).toBe('waiting_approval');
});

it('preserves passes:false and stops verification after the first failed command', async () => {
  const owner = await verificationFixture('verification-failure', false, true);
  expect(await owner.post('verify-feature', owner.input)).toEqual({
    status: 200,
    body: { success: true, passes: false },
  });
  expect((await readFile(path.join(owner.project, 'checks.jsonl'), 'utf8')).trim()).toBe('lint');
});

it('retains verification ownership when command cleanup cannot be confirmed', async () => {
  const owner = await verificationFixture('verification-uncertain');
  const manager = owner.runtime.getGlobalService().getSharedServices().concurrencyManager;
  const execute = vi
    .spyOn(LocalExecutionEnvironment.prototype, 'exec')
    .mockRejectedValue(
      new ExecutionEnvironmentError('PROCESS_CLEANUP_FAILED', 'Owned test uncertainty')
    );
  try {
    await expect(
      owner.runtime.verifyFeature(owner.project, owner.input.featureId)
    ).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
    expect(manager.getRunningFeature(owner.input.featureId)?.retainUntilCleanup).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    await expect(
      owner.runtime.verifyFeature(owner.project, owner.input.featureId)
    ).rejects.toMatchObject({ statusCode: 409 });
  } finally {
    // The mocked command spawned no process; explicitly clean up only this owned fixture lease.
    manager.release(owner.input.featureId, {
      force: true,
      expected: manager.getRunningFeature(owner.input.featureId),
    });
    execute.mockRestore();
  }
});

it('uses the same verification lease signal for managed preflight and all four commands', async () => {
  const owner = await verificationFixture('verification-managed');
  const manager = owner.runtime.getGlobalService().getSharedServices().concurrencyManager;
  const exec = vi.fn(async (_command, signal) => {
    const lease = manager.getRunningFeature(owner.input.featureId)!;
    expect(lease.state).toBe('testing');
    expect(signal).toBe(lease.abortController.signal);
    return { exitCode: 0, output: 'owned managed fixture', truncated: false };
  });
  const prepare = vi
    .spyOn(FeatureWorkspaceService.prototype, 'prepare')
    .mockImplementation(async (_project, _feature, signal, provision) => {
      const lease = manager.getRunningFeature(owner.input.featureId)!;
      expect(lease).toBeDefined();
      expect(signal).toBe(lease.abortController.signal);
      expect(provision).toBe(false);
      return { environment: { cwd: '/owned/remote-fixture', exec } } as never;
    });
  try {
    expect(await owner.post('verify-feature', owner.input)).toEqual({
      status: 200,
      body: { success: true, passes: true },
    });
    expect(exec.mock.calls.map((call) => call[0])).toEqual([
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run build',
    ]);
  } finally {
    prepare.mockRestore();
  }
});

it.skipIf(process.platform !== 'linux')(
  'rejects concurrent local verification and stops its owned process before releasing the lease',
  async () => {
    const owner = await verificationFixture('verification-stop', true);
    const manager = owner.runtime.getGlobalService().getSharedServices().concurrencyManager;
    const verifying = owner.post('verify-feature', owner.input);
    let pid = 0;
    await vi.waitFor(async () => {
      pid = Number(await readFile(path.join(owner.project, 'verification.pid'), 'utf8'));
      expect(pid).toBeGreaterThan(0);
    });
    expect(await owner.post('verify-feature', owner.input)).toMatchObject({
      status: 409,
      body: { success: false },
    });
    expect(manager.getRunningFeature(owner.input.featureId)?.retainUntilCleanup).toBe(true);
    expect(await owner.post('stop-feature', { featureId: owner.input.featureId })).toMatchObject({
      status: 200,
      body: { stopped: true },
    });
    expect(await verifying).toEqual({ status: 200, body: { success: true, passes: false } });
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    expect(manager.getRunningFeature(owner.input.featureId)).toBeUndefined();
    expect((await readFile(path.join(owner.project, 'checks.jsonl'), 'utf8')).trim()).toBe('lint');
  }
);

it.skipIf(process.platform !== 'linux')(
  'aborts and drains an accepted verification request during native shutdown',
  async () => {
    const owner = await verificationFixture('verification-shutdown', true);
    const verifying = owner.post('verify-feature', owner.input);
    let pid = 0;
    await vi.waitFor(async () => {
      pid = Number(await readFile(path.join(owner.project, 'verification.pid'), 'utf8'));
      expect(pid).toBeGreaterThan(0);
    });
    await owner.app.close();
    expect(await verifying).toEqual({ status: 200, body: { success: true, passes: false } });
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    expect(
      owner.runtime
        .getGlobalService()
        .getSharedServices()
        .concurrencyManager.getRunningFeature(owner.input.featureId)
    ).toBeUndefined();
  }
);
