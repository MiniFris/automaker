import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { DEFAULT_EXECUTION_STATE, RecoveryService } from '../../src/services/recovery-service.js';
import { ConcurrencyManager } from '../../src/services/concurrency-manager.js';
import { AgentExecutor } from '../../src/services/agent-executor.js';
import { TypedEventBus } from '../../src/services/typed-event-bus.js';
import { createEventEmitter } from '../../src/lib/events.js';
import {
  capturedExecutionFilesystem,
  type ExecutionFilesystem,
} from '../../src/services/execution-filesystem.js';
import { MockProvider } from '../helpers/mock-provider.js';
import { PipelineOrchestrator } from '../../src/services/pipeline-orchestrator.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import type { ExecuteOptions } from '@automaker/types';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-fs-'));
});
afterEach(async () => {
  await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
class OfflineExecutionProvider extends MockProvider {
  protected async *execute(_options: ExecuteOptions) {
    yield {
      type: 'assistant' as const,
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Mock agent output for testing. '.repeat(16) }],
      },
    };
    yield { type: 'result' as const, subtype: 'success' as const };
  }
}
async function owner(name: string, discoverExecutionOwners = false) {
  const project = path.join(root, name);
  await fs.mkdir(project);
  const runtime = await createNestApplication({
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [
      { name: 'claude', create: () => new OfflineExecutionProvider('claude') },
    ],
    environment: { NODE_ENV: 'test', ALLOWED_ROOT_DIRECTORY: project },
  });
  apps.push(runtime);
  const filesystem = runtime.app.get<ExecutionFilesystem>(SECURE_FILESYSTEM);
  const facade = runtime.app.get(AutoModeServiceCompat).createFacade(project) as any;
  let executor: AgentExecutor | undefined, pipeline: PipelineOrchestrator | undefined;
  if (discoverExecutionOwners) {
    const execute = vi.spyOn(AgentExecutor.prototype, 'execute');
    const runPipeline = vi.spyOn(PipelineOrchestrator.prototype, 'executePipeline');
    try {
      await runtime.app.get(PipelineService).savePipelineConfig(project, {
        version: 1,
        steps: [
          {
            id: 'scope-probe',
            name: 'Scope probe',
            order: 0,
            instructions: 'Offline owner identity probe',
            colorClass: 'blue',
            createdAt: '',
            updatedAt: '',
          },
        ],
      });
      await runtime.app.get(FeatureLoader).create(project, {
        id: 'scope-probe',
        title: 'Scope probe',
        description: 'Offline fixture',
        model: 'claude-sonnet',
        status: 'backlog',
        planningMode: 'skip',
        skipTests: true,
      });
      await facade.executeFeature('scope-probe', false, false);
      executor = execute.mock.contexts[0];
      pipeline = runPipeline.mock.contexts[0];
      expect(executor).toBeInstanceOf(AgentExecutor);
      expect(pipeline).toBeInstanceOf(PipelineOrchestrator);
    } finally {
      execute.mockRestore();
      runPipeline.mockRestore();
    }
  }
  return { ...runtime, project, filesystem, facade, executor, pipeline };
}
function recovery(filesystem: ExecutionFilesystem) {
  const manager = new ConcurrencyManager();
  const execute = vi.fn().mockResolvedValue(undefined);
  const service = new RecoveryService(
    new TypedEventBus(createEventEmitter()),
    manager,
    null,
    execute,
    vi.fn().mockResolvedValue({ id: 'feature', title: 'Owned', status: 'interrupted' }),
    vi.fn().mockResolvedValue({ isPipeline: false }),
    vi.fn(),
    () => false,
    (options) => manager.acquire(options),
    (id, run) => manager.release(id, { expected: run }),
    filesystem
  );
  return { service, execute };
}

it('injects one native filesystem into every execution owner and isolates state/context after another app closes', async () => {
  const first = await owner('first', true),
    second = await owner('second', true);
  for (const runtime of [first, second]) {
    for (const service of [
      runtime.facade,
      runtime.facade.executionService,
      runtime.pipeline,
      runtime.executor,
      runtime.facade.recoveryService,
    ]) {
      expect(service.filesystem).toBe(runtime.filesystem);
    }
    await runtime.facade.recoveryService.saveExecutionState(runtime.project);
  }
  await expect(first.facade.recoveryService.saveExecutionState(second.project)).rejects.toThrow();
  await expect(
    first.facade.recoveryService.contextExists(second.project, 'feature')
  ).rejects.toThrow();
  await first.app.close();
  expect(await second.facade.recoveryService.loadExecutionState(second.project)).toMatchObject({
    projectPath: second.project,
  });
  await second.facade.recoveryService.clearExecutionState(second.project);
  await expect(
    fs.access(path.join(second.project, '.automaker/execution-state.json'))
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('writes actual output through the native executor and rejects captured memory writes after replacement', async () => {
  vi.stubEnv('AUTOMAKER_DEBUG_RAW_OUTPUT', 'true');
  const runtime = await owner('output', true);
  const manager = new ConcurrencyManager();
  const input = { projectPath: runtime.project, featureId: 'feature', isAutoMode: false };
  const run = manager.acquire(input);
  const port = manager.coordinator.bind(manager, run);
  const local = capturedExecutionFilesystem(runtime.filesystem, port);
  const memory = path.join(runtime.project, 'memory.md');
  await local.writeFile(memory, 'owned memory');
  await runtime.executor!.execute(
    {
      workDir: runtime.project,
      projectPath: runtime.project,
      featureId: 'feature',
      prompt: 'Owned fixture',
      abortController: run.abortController,
      runPort: port,
      provider: new MockProvider('claude'),
      effectiveBareModel: 'claude-sonnet',
      sdkOptions: { maxTurns: 1 },
    },
    {
      waitForApproval: vi.fn(),
      saveFeatureSummary: vi.fn(),
      updateFeatureSummary: vi.fn(),
      buildTaskPrompt: vi.fn(),
    }
  );
  expect(
    await fs.readFile(
      path.join(runtime.project, '.automaker/features/feature/agent-output.md'),
      'utf8'
    )
  ).toContain('Mock agent output for testing.');
  expect(
    await fs.readFile(
      path.join(runtime.project, '.automaker/features/feature/raw-output.jsonl'),
      'utf8'
    )
  ).toContain('Mock agent output for testing.');
  const other = await owner('forbidden-output');
  // Isolate artifact IO from the earlier SettingsService project-policy boundary.
  const scopedExecutor = new AgentExecutor(
    new TypedEventBus(createEventEmitter()),
    {} as never,
    {} as never,
    null,
    runtime.filesystem
  );
  await scopedExecutor.execute(
    {
      workDir: other.project,
      projectPath: other.project,
      featureId: 'feature',
      prompt: 'Denied output',
      abortController: run.abortController,
      runPort: port,
      provider: new MockProvider('claude'),
      effectiveBareModel: 'claude-sonnet',
      sdkOptions: { maxTurns: 1 },
    },
    {
      waitForApproval: vi.fn(),
      saveFeatureSummary: vi.fn(),
      updateFeatureSummary: vi.fn(),
      buildTaskPrompt: vi.fn(),
    }
  );
  await expect(
    fs.access(path.join(other.project, '.automaker/features/feature/agent-output.md'))
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(
    fs.access(path.join(other.project, '.automaker/features/feature/raw-output.jsonl'))
  ).rejects.toMatchObject({ code: 'ENOENT' });
  manager.release('feature', { force: true, expected: run });
  await manager.acquireAsync(input);
  await expect(local.writeFile(memory, 'stale')).rejects.toMatchObject({ name: 'AbortError' });
  expect(await fs.readFile(memory, 'utf8')).toBe('owned memory');
});

it.each(['EIO', 'EACCES', '403'])(
  'does not query or clear persisted state when context access fails with %s',
  async (code) => {
    const runtime = await owner(code);
    const { service, execute } = recovery(runtime.filesystem);
    await service.saveExecutionState(runtime.project);
    const state = path.join(runtime.project, '.automaker/execution-state.json');
    const bytes = await fs.readFile(state, 'utf8');
    const feature = path.join(runtime.project, '.automaker/features/feature/feature.json');
    await fs.mkdir(path.dirname(feature), { recursive: true });
    await fs.writeFile(feature, JSON.stringify({ id: 'feature', status: 'interrupted' }));
    vi.spyOn(runtime.filesystem, 'access').mockRejectedValue(
      Object.assign(new Error(code), code === '403' ? { statusCode: 403 } : { code })
    );
    await expect(service.resumeFeature(runtime.project, 'feature')).rejects.toMatchObject(
      code === '403' ? { statusCode: 403 } : { code }
    );
    await expect(service.resumeInterruptedFeatures(runtime.project)).rejects.toMatchObject(
      code === '403' ? { statusCode: 403 } : { code }
    );
    expect(execute).not.toHaveBeenCalled();
    expect(await fs.readFile(state, 'utf8')).toBe(bytes);
  }
);

it.each([
  '{',
  'null',
  '{"version":2}',
  JSON.stringify({ ...DEFAULT_EXECUTION_STATE, autoLoopWasRunning: 'yes' }),
  JSON.stringify({ ...DEFAULT_EXECUTION_STATE, runningFeatureIds: 'feature' }),
])('keeps unknown/corrupted recovery state without replay: %s', async (bytes) => {
  const runtime = await owner('invalid');
  if (bytes.includes('projectPath'))
    bytes = JSON.stringify({ ...JSON.parse(bytes), projectPath: runtime.project });
  const { service, execute } = recovery(runtime.filesystem);
  const state = path.join(runtime.project, '.automaker/execution-state.json');
  await fs.mkdir(path.dirname(state), { recursive: true });
  await fs.writeFile(state, bytes);
  await expect(service.resumeInterruptedFeatures(runtime.project)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  expect(await fs.readFile(state, 'utf8')).toBe(bytes);
});
