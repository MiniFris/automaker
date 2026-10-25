/**
 * RecoveryService - Crash recovery and feature resumption
 */

import path from 'path';
import type { Feature, FeatureStatusWithPipeline } from '@automaker/types';
import { DEFAULT_MAX_CONCURRENCY, isDirectModel } from '@automaker/types';
import { atomicWriteJson, createLogger } from '@automaker/utils';
import { getFeatureDir, getFeaturesDir, getExecutionStatePath } from '@automaker/platform';
import type { ExecutionFilesystem } from './execution-filesystem.js';
import { getPromptCustomization } from '../lib/settings-helpers.js';
import type { TypedEventBus } from './typed-event-bus.js';
import type { ConcurrencyManager, RunningFeature } from './concurrency-manager.js';
import type { SettingsService } from './settings-service.js';
import type { PipelineStatusInfo } from './pipeline-orchestrator.js';
import { UnavailableDomainError } from '../core/errors/domain-errors.js';

const logger = createLogger('RecoveryService');
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const unsafeIo = (error: unknown) => {
  const value = error as { code?: string; statusCode?: number; name?: string };
  return (
    value?.name === 'AbortError' ||
    value?.statusCode === 403 ||
    value?.statusCode === 503 ||
    (typeof value?.code === 'string' && /^(E[A-Z]+|FILESYSTEM_)/.test(value.code))
  );
};

export interface ExecutionState {
  version: 1;
  autoLoopWasRunning: boolean;
  maxConcurrency: number;
  projectPath: string;
  branchName: string | null;
  runningFeatureIds: string[];
  savedAt: string;
}

export const DEFAULT_EXECUTION_STATE: ExecutionState = {
  version: 1,
  autoLoopWasRunning: false,
  maxConcurrency: DEFAULT_MAX_CONCURRENCY,
  projectPath: '',
  branchName: null,
  runningFeatureIds: [],
  savedAt: '',
};

export type ExecuteFeatureFn = (
  projectPath: string,
  featureId: string,
  useWorktrees: boolean,
  isAutoMode: boolean,
  providedWorktreePath?: string,
  options?: { continuationPrompt?: string; _calledInternally?: boolean; _run?: RunningFeature }
) => Promise<void>;
export type LoadFeatureFn = (
  projectPath: string,
  featureId: string,
  strict?: boolean
) => Promise<Feature | null>;
export type DetectPipelineStatusFn = (
  projectPath: string,
  featureId: string,
  status: FeatureStatusWithPipeline
) => Promise<PipelineStatusInfo>;
export type ResumePipelineFn = (
  projectPath: string,
  feature: Feature,
  useWorktrees: boolean,
  pipelineInfo: PipelineStatusInfo,
  expected?: RunningFeature
) => Promise<void>;
export type IsFeatureRunningFn = (featureId: string) => boolean;
export type AcquireRunningFeatureFn = (options: {
  featureId: string;
  projectPath: string;
  isAutoMode: boolean;
  allowReuse?: boolean;
  expected?: RunningFeature;
}) => RunningFeature | Promise<RunningFeature>;
export type ReleaseRunningFeatureFn = (featureId: string, expected?: RunningFeature) => void;

export class RecoveryService {
  private readonly stateTails = new Map<string, Promise<void>>();
  private statePending = 0;
  private closing?: Promise<void>;

  private stateOperation<T>(project: string, operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new UnavailableDomainError('Recovery storage is shutting down.'));
    if (this.statePending >= 256)
      return Promise.reject(new UnavailableDomainError('Recovery storage is busy.'));
    const key = path.resolve(getExecutionStatePath(project));
    const previous = this.stateTails.get(key) ?? Promise.resolve();
    this.statePending++;
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    this.stateTails.set(key, settled);
    void settled.then(() => {
      this.statePending--;
      if (this.stateTails.get(key) === settled) this.stateTails.delete(key);
    });
    return result;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    let timer: NodeJS.Timeout;
    this.closing = Promise.race([
      Promise.all([...this.stateTails.values()]).then(() => undefined),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new UnavailableDomainError('Recovery storage cleanup could not be confirmed.')),
          5000
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }

  constructor(
    private eventBus: TypedEventBus,
    private concurrencyManager: ConcurrencyManager,
    private settingsService: SettingsService | null,
    private executeFeatureFn: ExecuteFeatureFn,
    private loadFeatureFn: LoadFeatureFn,
    private detectPipelineStatusFn: DetectPipelineStatusFn,
    private resumePipelineFn: ResumePipelineFn,
    private isFeatureRunningFn: IsFeatureRunningFn,
    private acquireRunningFeatureFn: AcquireRunningFeatureFn,
    private releaseRunningFeatureFn: ReleaseRunningFeatureFn,
    private readonly filesystem: ExecutionFilesystem,
    private readonly isStopping: () => boolean = () => false
  ) {}

  async saveExecutionStateForProject(
    projectPath: string,
    branchName: string | null,
    maxConcurrency: number
  ): Promise<void> {
    return this.stateOperation(projectPath, async () => {
      const runningFeatureIds = this.concurrencyManager
        .getAllRunning()
        .filter((f) => f.projectPath === projectPath)
        .map((f) => f.featureId);
      const state: ExecutionState = {
        version: 1,
        autoLoopWasRunning: true,
        maxConcurrency,
        projectPath,
        branchName,
        runningFeatureIds,
        savedAt: new Date().toISOString(),
      };
      await atomicWriteJson(getExecutionStatePath(projectPath), state, {
        filesystem: this.filesystem,
        recoverableTemporaryFiles: false,
      });
    });
  }

  async saveExecutionState(
    projectPath: string,
    autoLoopWasRunning = false,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY
  ): Promise<void> {
    return this.stateOperation(projectPath, async () => {
      const state: ExecutionState = {
        version: 1,
        autoLoopWasRunning,
        maxConcurrency,
        projectPath,
        branchName: null,
        runningFeatureIds: this.concurrencyManager
          .getAllRunning()
          .filter((rf) => rf.projectPath === projectPath)
          .map((rf) => rf.featureId),
        savedAt: new Date().toISOString(),
      };
      await atomicWriteJson(getExecutionStatePath(projectPath), state, {
        filesystem: this.filesystem,
        recoverableTemporaryFiles: false,
      });
    });
  }

  async loadExecutionState(projectPath: string, strictRecovery = false): Promise<ExecutionState> {
    return this.stateOperation(projectPath, async () => {
      try {
        const content = (await this.filesystem.readFile(
          getExecutionStatePath(projectPath),
          'utf-8'
        )) as string;
        const state: unknown = JSON.parse(content);
        if (strictRecovery) {
          const value = state as Partial<ExecutionState> | null;
          if (
            !value ||
            typeof value !== 'object' ||
            value.version !== 1 ||
            typeof value.autoLoopWasRunning !== 'boolean' ||
            !Number.isInteger(value.maxConcurrency) ||
            value.maxConcurrency! < 1 ||
            value.projectPath !== projectPath ||
            !(value.branchName === null || typeof value.branchName === 'string') ||
            !Array.isArray(value.runningFeatureIds) ||
            !value.runningFeatureIds.every((id) => typeof id === 'string' && id.length > 0) ||
            typeof value.savedAt !== 'string'
          ) {
            throw new Error(
              'Unsupported execution state; automatic recovery requires a valid version 1 state'
            );
          }
        }
        return state as ExecutionState;
      } catch (error) {
        if (missing(error) || (!strictRecovery && error instanceof SyntaxError))
          return DEFAULT_EXECUTION_STATE;
        throw error;
      }
    });
  }

  async clearExecutionState(projectPath: string, _branchName: string | null = null): Promise<void> {
    return this.stateOperation(projectPath, async () => {
      try {
        await this.filesystem.unlink(getExecutionStatePath(projectPath));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    });
  }

  async contextExists(projectPath: string, featureId: string): Promise<boolean> {
    try {
      await this.filesystem.access(
        path.join(getFeatureDir(projectPath, featureId), 'agent-output.md')
      );
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }

  private async executeFeatureWithContext(
    projectPath: string,
    featureId: string,
    context: string,
    useWorktrees: boolean,
    lease: RunningFeature
  ): Promise<void> {
    const feature = await this.loadFeatureFn(projectPath, featureId);
    if (!feature) throw new Error(`Feature ${featureId} not found`);
    const prompts = await getPromptCustomization(this.settingsService, '[RecoveryService]');
    const featurePrompt = `## Feature Implementation Task\n\n**Feature ID:** ${feature.id}\n**Title:** ${feature.title || 'Untitled Feature'}\n**Description:** ${feature.description}\n`;
    let prompt = prompts.taskExecution.resumeFeatureTemplate;
    prompt = prompt
      .replace(/\{\{featurePrompt\}\}/g, featurePrompt)
      .replace(/\{\{previousContext\}\}/g, context);
    return this.executeFeatureFn(projectPath, featureId, useWorktrees, false, undefined, {
      continuationPrompt: prompt,
      _calledInternally: true,
      _run: lease,
    });
  }

  async resumeFeature(
    projectPath: string,
    featureId: string,
    useWorktrees = false,
    _calledInternally = false,
    expected?: RunningFeature
  ): Promise<void> {
    if (this.isStopping()) return;
    if (!_calledInternally && this.isFeatureRunningFn(featureId)) return;
    const lease = await this.acquireRunningFeatureFn({
      featureId,
      projectPath,
      isAutoMode: false,
      allowReuse: _calledInternally,
      expected,
    });
    try {
      const feature = await this.loadFeatureFn(projectPath, featureId);
      if (!feature) throw new Error(`Feature ${featureId} not found`);
      const pipelineInfo = await this.detectPipelineStatusFn(
        projectPath,
        featureId,
        (feature.status || '') as FeatureStatusWithPipeline
      );
      if (pipelineInfo.isPipeline)
        return await this.resumePipelineFn(projectPath, feature, useWorktrees, pipelineInfo, lease);
      const hasContext = await this.contextExists(projectPath, featureId);
      if (hasContext) {
        const context = (await this.filesystem.readFile(
          path.join(getFeatureDir(projectPath, featureId), 'agent-output.md'),
          'utf-8'
        )) as string;
        this.eventBus.emitAutoModeEvent('auto_mode_feature_resuming', {
          featureId,
          featureName: feature.title,
          projectPath,
          hasContext: true,
          message: `Resuming feature "${feature.title}" from saved context`,
        });
        return await this.executeFeatureWithContext(
          projectPath,
          featureId,
          context,
          useWorktrees,
          lease
        );
      }
      this.eventBus.emitAutoModeEvent('auto_mode_feature_resuming', {
        featureId,
        featureName: feature.title,
        projectPath,
        hasContext: false,
        message: `Starting fresh execution for interrupted feature "${feature.title}"`,
      });
      return await this.executeFeatureFn(projectPath, featureId, useWorktrees, false, undefined, {
        _calledInternally: true,
        _run: lease,
      });
    } finally {
      this.releaseRunningFeatureFn(featureId, lease);
    }
  }

  async resumeInterruptedFeatures(projectPath: string): Promise<void> {
    if (this.isStopping()) return;
    const featuresDir = getFeaturesDir(projectPath);
    try {
      // Load execution state to find features that were running before restart.
      // This is critical because reconcileAllFeatureStates() runs at server startup
      // and resets in_progress/interrupted/pipeline_* features to ready/backlog
      // BEFORE the UI connects and calls this method. Without checking execution state,
      // we would find no features to resume since their statuses have already been reset.
      const executionState = await this.loadExecutionState(projectPath, true);
      const previouslyRunningIds = new Set(executionState.runningFeatureIds ?? []);

      const entries = await this.filesystem.readdir(featuresDir, { withFileTypes: true });
      const featuresWithContext: Feature[] = [];
      const featuresWithoutContext: Feature[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Native loader owns backup restoration and serializes it with feature mutations.
          const feature = await this.loadFeatureFn(projectPath, entry.name, true);
          if (!feature) continue;
          // No automatic replay of an ambiguous direct run. Single-feature manual
          // resume remains available; crash-safe run/tool journaling is stage 6.
          if (isDirectModel(feature.model)) {
            logger.info(
              `Direct feature ${feature.id} requires explicit resume after reviewing its workspace.`
            );
            continue;
          }

          // Check if the feature should be resumed:
          // 1. Features still in active states (in_progress, pipeline_*) - not yet reconciled
          // 2. Features in interrupted state - explicitly marked for resume
          // 3. Features that were previously running (from execution state) and are now
          //    in ready/backlog due to reconciliation resetting their status
          const isActiveState =
            feature.status === 'in_progress' ||
            feature.status === 'interrupted' ||
            (feature.status && feature.status.startsWith('pipeline_'));
          const wasReconciledFromRunning =
            previouslyRunningIds.has(feature.id) &&
            (feature.status === 'ready' || feature.status === 'backlog');

          if (isActiveState || wasReconciledFromRunning) {
            if (await this.contextExists(projectPath, feature.id)) {
              featuresWithContext.push(feature);
            } else {
              featuresWithoutContext.push(feature);
            }
          }
        }
      }
      const allInterruptedFeatures = [...featuresWithContext, ...featuresWithoutContext];
      if (allInterruptedFeatures.length === 0) return;

      logger.info(
        `[resumeInterruptedFeatures] Found ${allInterruptedFeatures.length} feature(s) to resume ` +
          `(${previouslyRunningIds.size} from execution state, statuses: ${allInterruptedFeatures.map((f) => `${f.id}=${f.status}`).join(', ')})`
      );

      this.eventBus.emitAutoModeEvent('auto_mode_resuming_features', {
        message: `Resuming ${allInterruptedFeatures.length} interrupted feature(s)`,
        projectPath,
        featureIds: allInterruptedFeatures.map((f) => f.id),
        features: allInterruptedFeatures.map((f) => ({
          id: f.id,
          title: f.title,
          status: f.status,
          branchName: f.branchName ?? null,
          hasContext: featuresWithContext.some((fc) => fc.id === f.id),
        })),
      });
      for (const feature of allInterruptedFeatures) {
        if (this.isStopping()) return;
        try {
          if (!this.isFeatureRunningFn(feature.id))
            await this.resumeFeature(projectPath, feature.id, true);
        } catch (error) {
          if (unsafeIo(error)) throw error;
        }
      }

      // Clear execution state after successful resume to prevent
      // re-resuming the same features on subsequent calls
      if (!this.isStopping()) await this.clearExecutionState(projectPath);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}
