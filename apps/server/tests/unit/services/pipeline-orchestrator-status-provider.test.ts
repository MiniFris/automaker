import * as executionFilesystem from '../../../src/lib/secure-fs.js';
/**
 * Tests for status + providerId coexistence in PipelineOrchestrator options.
 *
 * During rebase onto upstream/v1.0.0rc, a merge conflict arose where
 * upstream added `status: currentStatus` and the incoming branch added
 * `providerId: feature.providerId`. The conflict resolution kept BOTH fields.
 *
 * This test validates that both fields coexist correctly in the options
 * object passed to runAgentFn in executePipeline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Feature, PipelineStep } from '@automaker/types';
import {
  PipelineOrchestrator,
  type PipelineContext,
  type UpdateFeatureStatusFn,
  type BuildFeaturePromptFn,
  type ExecuteFeatureFn,
  type RunAgentFn,
} from '../../../src/services/pipeline-orchestrator.js';
import type { TypedEventBus } from '../../../src/services/typed-event-bus.js';
import type { FeatureStateManager } from '../../../src/services/feature-state-manager.js';
import type { WorktreeResolver } from '../../../src/services/worktree-resolver.js';
import type { ConcurrencyManager } from '../../../src/services/concurrency-manager.js';
import * as secureFs from '../../../src/lib/secure-fs.js';
import { getFeatureDir } from '@automaker/platform';
import {
  getPromptCustomization,
  getAutoLoadClaudeMdSetting,
  filterClaudeMdFromContext,
} from '../../../src/lib/settings-helpers.js';

const pipelineService = {
  isPipelineStatus: vi.fn(),
  getStepIdFromStatus: vi.fn(),
  getPipelineConfig: vi.fn(),
  getNextStatus: vi.fn(),
};

vi.mock('../../../src/services/merge-service.js', () => ({
  createLocalMergeExecutor: vi.fn(() => ({
    execute: vi.fn().mockResolvedValue('main'),
    signal: new AbortController().signal,
  })),
  performMerge: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../src/lib/secure-fs.js', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
}));

vi.mock('../../../src/lib/settings-helpers.js', () => ({
  getPromptCustomization: vi.fn().mockResolvedValue({
    taskExecution: {
      implementationInstructions: 'test instructions',
      playwrightVerificationInstructions: 'test playwright',
    },
  }),
  getAutoLoadClaudeMdSetting: vi.fn().mockResolvedValue(true),
  getUseClaudeCodeSystemPromptSetting: vi.fn().mockResolvedValue(true),
  filterClaudeMdFromContext: vi.fn().mockReturnValue('context prompt'),
}));

vi.mock('../../../src/lib/sdk-options.js', () => ({
  validateWorkingDirectory: vi.fn(),
}));

vi.mock('@automaker/platform', () => ({
  getFeatureDir: vi
    .fn()
    .mockImplementation(
      (projectPath: string, featureId: string) => `${projectPath}/.automaker/features/${featureId}`
    ),
}));

vi.mock('@automaker/model-resolver', () => ({
  resolveModelString: vi.fn().mockReturnValue('claude-sonnet-4'),
  DEFAULT_MODELS: { claude: 'claude-sonnet-4' },
}));

describe('PipelineOrchestrator - status and providerId coexistence', () => {
  let mockRunAgentFn: RunAgentFn;
  let orchestrator: PipelineOrchestrator;

  const testSteps: PipelineStep[] = [
    {
      id: 'implement',
      name: 'Implement Feature',
      order: 1,
      instructions: 'Implement the feature',
      colorClass: 'blue',
      createdAt: '',
      updatedAt: '',
    },
  ];

  const createFeature = (overrides: Partial<Feature> = {}): Feature => ({
    id: 'feature-1',
    title: 'Test Feature',
    category: 'test',
    description: 'Test description',
    status: 'pipeline_implement',
    branchName: 'feature/test-1',
    providerId: 'moonshot-ai',
    thinkingLevel: 'medium',
    reasoningEffort: 'high',
    ...overrides,
  });

  const createContext = (feature: Feature): PipelineContext => ({
    projectPath: '/test/project',
    featureId: feature.id,
    feature,
    steps: testSteps,
    workDir: '/test/project',
    worktreePath: null,
    branchName: feature.branchName ?? 'main',
    abortController: new AbortController(),
    autoLoadClaudeMd: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgentFn = vi.fn().mockResolvedValue(undefined);

    vi.mocked(secureFs.readFile).mockResolvedValue('Previous context');
    vi.mocked(secureFs.access).mockResolvedValue(undefined);
    vi.mocked(getFeatureDir).mockImplementation(
      (projectPath: string, featureId: string) => `${projectPath}/.automaker/features/${featureId}`
    );
    vi.mocked(getPromptCustomization).mockResolvedValue({
      taskExecution: {
        implementationInstructions: 'test instructions',
        playwrightVerificationInstructions: 'test playwright',
      },
    } as any);
    vi.mocked(getAutoLoadClaudeMdSetting).mockResolvedValue(true);
    vi.mocked(filterClaudeMdFromContext).mockReturnValue('context prompt');

    const mockEventBus = {
      emitAutoModeEvent: vi.fn(),
      getUnderlyingEmitter: vi.fn().mockReturnValue({}),
    } as unknown as TypedEventBus;

    const mockFeatureStateManager = {
      updateFeatureStatus: vi.fn().mockResolvedValue(undefined),
      loadFeature: vi.fn().mockResolvedValue(createFeature()),
    } as unknown as FeatureStateManager;

    orchestrator = new PipelineOrchestrator(
      mockEventBus,
      mockFeatureStateManager,
      {
        findWorktreeForBranch: vi.fn().mockResolvedValue('/test/worktree'),
        getCurrentBranch: vi.fn().mockResolvedValue('main'),
      } as unknown as WorktreeResolver,
      {
        acquire: vi.fn().mockImplementation(({ featureId }) => ({
          featureId,
          projectPath: '/test/project',
          abortController: new AbortController(),
          branchName: null,
          worktreePath: null,
          isAutoMode: false,
        })),
        release: vi.fn(),
        getRunningFeature: vi.fn().mockReturnValue({ featureId: 'feature-1' }),
        executeOwned: vi.fn((_run, _phase, action) => action()),
        markExecutionUncertain: vi.fn(),
        isCurrent: vi.fn().mockReturnValue(true),
        coordinator: {
          bind: vi.fn(() => ({
            assertCurrent: vi.fn(),
            transition: vi.fn(),
            mutate: async (write) => {
              await write();
            },
          })),
          status: vi.fn(async (_manager, _run, _status, write) => {
            await write();
            return true;
          }),
          acceptCompletion: vi.fn().mockReturnValue(true),
        },
      } as unknown as ConcurrencyManager,
      null,
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue({ contextPrompt: 'test context' }),
      vi.fn().mockReturnValue('Feature prompt content'),
      vi.fn().mockResolvedValue(undefined),
      mockRunAgentFn,
      pipelineService as never,
      executionFilesystem
    );
  });

  describe('executePipeline - options object', () => {
    it('should pass both status and providerId in options', async () => {
      const feature = createFeature({ providerId: 'moonshot-ai' });
      const context = createContext(feature);

      await orchestrator.executePipeline(context);

      expect(mockRunAgentFn).toHaveBeenCalledTimes(1);
      const options = mockRunAgentFn.mock.calls[0][7];
      expect(options).toHaveProperty('status', 'pipeline_implement');
      expect(options).toHaveProperty('providerId', 'moonshot-ai');
    });

    it('should pass status even when providerId is undefined', async () => {
      const feature = createFeature({ providerId: undefined });
      const context = createContext(feature);

      await orchestrator.executePipeline(context);

      const options = mockRunAgentFn.mock.calls[0][7];
      expect(options).toHaveProperty('status', 'pipeline_implement');
      expect(options).toHaveProperty('providerId', undefined);
    });

    it('should pass thinkingLevel and reasoningEffort alongside status and providerId', async () => {
      const feature = createFeature({
        providerId: 'zhipu',
        thinkingLevel: 'high',
        reasoningEffort: 'medium',
      });
      const context = createContext(feature);

      await orchestrator.executePipeline(context);

      const options = mockRunAgentFn.mock.calls[0][7];
      expect(options).toHaveProperty('status', 'pipeline_implement');
      expect(options).toHaveProperty('providerId', 'zhipu');
      expect(options).toHaveProperty('thinkingLevel', 'high');
      expect(options).toHaveProperty('reasoningEffort', 'medium');
    });
  });
});
