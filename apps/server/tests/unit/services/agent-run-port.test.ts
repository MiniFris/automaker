import * as executionFilesystem from '../../../src/lib/secure-fs.js';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentExecutor } from '../../../src/services/agent-executor.js';
import { ConcurrencyManager } from '../../../src/services/concurrency-manager.js';
import { TypedEventBus } from '../../../src/services/typed-event-bus.js';
import { createEventEmitter } from '../../../src/lib/events.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import type { ProviderMessage } from '../../../src/providers/types.js';
import * as secureFs from '../../../src/lib/secure-fs.js';

vi.mock('../../../src/lib/secure-fs.js', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => vi.restoreAllMocks());

it('drains an accepted output write before admitting a replacement incarnation', async () => {
  const manager = new ConcurrencyManager();
  const input = { projectPath: '/project', featureId: 'feature', isAutoMode: false };
  const first = manager.acquire(input);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.mocked(secureFs.writeFile).mockImplementationOnce(() => pending);
  const executor = new AgentExecutor(
    new TypedEventBus(createEventEmitter()),
    {} as never,
    {} as never,
    null,
    executionFilesystem
  );
  const execution = executor.execute(
    {
      workDir: '/project',
      projectPath: '/project',
      featureId: 'feature',
      prompt: 'Owned fixture',
      abortController: first.abortController,
      runPort: manager.coordinator.bind(manager, first),
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
  await vi.waitFor(() => expect(first.pendingMutations).toBe(1));
  manager.release(input.featureId, { force: true, expected: first });
  let admitted = false;
  const replacing = manager.acquireAsync(input).then((run) => {
    admitted = true;
    return run;
  });
  await Promise.resolve();
  expect(admitted).toBe(false);
  const stale = expect(execution).rejects.toMatchObject({ name: 'AbortError' });
  finish();
  await stale;
  const second = await replacing;
  expect(manager.getRunningFeature(input.featureId)).toBe(second);
});

it('rejects stale approval edits, plan/task/summary/output writes after a new incarnation starts', async () => {
  class Planner extends MockProvider {
    protected async *execute(): AsyncGenerator<ProviderMessage> {
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '## Owned plan\nImplement the fixture.\n[SPEC_GENERATED]' },
          ],
        },
      };
    }
  }
  const manager = new ConcurrencyManager();
  const input = { projectPath: '/project', featureId: 'feature', isAutoMode: false };
  const first = manager.acquire(input);
  const port = manager.coordinator.bind(manager, first);
  const state = { updateFeaturePlanSpec: vi.fn(), updateTaskStatus: vi.fn() };
  const executor = new AgentExecutor(
    new TypedEventBus(createEventEmitter()),
    state as never,
    {} as never,
    null,
    executionFilesystem
  );
  let approve!: (result: { approved: boolean; editedPlan?: string }) => void;
  const pending = new Promise<{ approved: boolean; editedPlan?: string }>((resolve) => {
    approve = resolve;
  });
  const callbacks = {
    waitForApproval: vi.fn(() => pending),
    saveFeatureSummary: vi.fn(),
    updateFeatureSummary: vi.fn(),
    buildTaskPrompt: vi.fn(() => ''),
  };
  const execution = executor.execute(
    {
      workDir: '/project',
      projectPath: '/project',
      featureId: 'feature',
      prompt: 'Plan fixture',
      abortController: first.abortController,
      planningMode: 'spec',
      requirePlanApproval: true,
      runPort: port,
      provider: new Planner('claude'),
      effectiveBareModel: 'claude-sonnet',
      sdkOptions: { maxTurns: 1 },
    },
    callbacks
  );
  await vi.waitFor(() => expect(callbacks.waitForApproval).toHaveBeenCalledOnce());
  expect(first.state).toBe('awaiting_plan_approval');
  manager.release(input.featureId, { force: true, expected: first });
  const second = await manager.acquireAsync(input);
  vi.mocked(secureFs.writeFile).mockClear();
  vi.mocked(secureFs.appendFile).mockClear();
  state.updateFeaturePlanSpec.mockClear();
  callbacks.updateFeatureSummary.mockClear();
  approve({ approved: true, editedPlan: 'stale-A-edits' });
  await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
  expect(manager.getRunningFeature(input.featureId)).toBe(second);
  expect(state.updateFeaturePlanSpec).not.toHaveBeenCalled();
  expect(state.updateTaskStatus).not.toHaveBeenCalled();
  expect(callbacks.updateFeatureSummary).not.toHaveBeenCalled();
  expect(callbacks.saveFeatureSummary).not.toHaveBeenCalled();
  expect(secureFs.writeFile).not.toHaveBeenCalled();
  expect(secureFs.appendFile).not.toHaveBeenCalled();
  expect(second.state).toBe('queued');
});
