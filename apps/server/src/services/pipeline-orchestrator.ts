/**
 * PipelineOrchestrator - Pipeline step execution and coordination
 */

import path from 'path';
import {
  isDirectModel,
  modelTimeout,
  providerModelTimeouts,
  getModelProvider,
} from '@automaker/types';
import { runDirectShellCommand } from '../providers/openai-compatible/execution.js';
import { FeatureWorkspaceService } from './execution-environment/feature-workspace.js';
import { hasRemoteEnvironment } from '../providers/environment-execution.js';
import { EnvironmentBindingStore } from './execution-environment/bindings.js';
import type {
  Feature,
  PipelineStep,
  PipelineConfig,
  FeatureStatusWithPipeline,
} from '@automaker/types';
import { createLogger, loadContextFiles, classifyError } from '@automaker/utils';
import { getFeatureDir } from '@automaker/platform';
import { resolveModelString, DEFAULT_MODELS } from '@automaker/model-resolver';
import { capturedExecutionFilesystem, type ExecutionFilesystem } from './execution-filesystem.js';
import {
  getPromptCustomization,
  getAutoLoadClaudeMdSetting,
  getUseClaudeCodeSystemPromptSetting,
  filterClaudeMdFromContext,
} from '../lib/settings-helpers.js';
import { validateWorkingDirectory } from '../lib/sdk-options.js';
import type { TypedEventBus } from './typed-event-bus.js';
import type { FeatureStateManager } from './feature-state-manager.js';
import type { AgentExecutor } from './agent-executor.js';
import type { WorktreeResolver } from './worktree-resolver.js';
import type { SettingsService } from './settings-service.js';
import type { ConcurrencyManager, RunningFeature } from './concurrency-manager.js';
import type { PipelineService } from './pipeline-service.js';
import type { TestRunnerService, TestRunStatus } from './test-runner-service.js';
import { performMerge } from './merge-service.js';
import type {
  PipelineContext,
  PipelineStatusInfo,
  StepResult,
  MergeResult,
  UpdateFeatureStatusFn,
  BuildFeaturePromptFn,
  ExecuteFeatureFn,
  RunAgentFn,
} from './pipeline-types.js';

// Re-export types for backward compatibility
export type {
  PipelineContext,
  PipelineStatusInfo,
  StepResult,
  MergeResult,
  UpdateFeatureStatusFn,
  BuildFeaturePromptFn,
  ExecuteFeatureFn,
  RunAgentFn,
} from './pipeline-types.js';

const logger = createLogger('PipelineOrchestrator');

export class PipelineOrchestrator {
  constructor(
    private eventBus: TypedEventBus,
    private featureStateManager: FeatureStateManager,
    private agentExecutor: AgentExecutor,
    private testRunnerService: TestRunnerService,
    private worktreeResolver: WorktreeResolver,
    private concurrencyManager: ConcurrencyManager,
    private settingsService: SettingsService | null,
    private updateFeatureStatusFn: UpdateFeatureStatusFn,
    private loadContextFilesFn: typeof loadContextFiles,
    private buildFeaturePromptFn: BuildFeaturePromptFn,
    private executeFeatureFn: ExecuteFeatureFn,
    private runAgentFn: RunAgentFn,
    private readonly pipeline: PipelineService,
    private readonly filesystem: ExecutionFilesystem,
    private readonly directoryValidator: (cwd: string) => void = validateWorkingDirectory
  ) {}

  private requireCurrent(run: RunningFeature | undefined): void {
    if (!run || !this.concurrencyManager.isCurrent(run)) {
      const error = new Error('Feature run was superseded');
      error.name = 'AbortError';
      throw error;
    }
  }

  private async writeStatus(
    run: RunningFeature | undefined,
    projectPath: string,
    featureId: string,
    status: string
  ): Promise<void> {
    if (
      !run ||
      !(await this.concurrencyManager.coordinator.status(this.concurrencyManager, run, status, () =>
        this.updateFeatureStatusFn(projectPath, featureId, status)
      ))
    ) {
      const error = new Error('Feature run was superseded');
      error.name = 'AbortError';
      throw error;
    }
    if (!this.concurrencyManager.isCurrent(run)) {
      const error = new Error('Feature run was superseded');
      error.name = 'AbortError';
      throw error;
    }
  }

  private canComplete(run: RunningFeature | undefined): boolean {
    return (
      !!run?.isAutoMode &&
      this.concurrencyManager.coordinator.acceptCompletion(
        this.concurrencyManager,
        run,
        'execution-complete'
      )
    );
  }

  async executePipeline(ctx: PipelineContext): Promise<void> {
    const run = ctx.run ?? this.concurrencyManager.getRunningFeature(ctx.featureId);
    this.requireCurrent(run);
    const localFilesystem = capturedExecutionFilesystem(
      this.filesystem,
      this.concurrencyManager.coordinator.bind(this.concurrencyManager, run!)
    );
    const remoteService = this.settingsService
      ? new FeatureWorkspaceService(this.settingsService)
      : undefined;
    const remote = await remoteService?.prepare(
      ctx.projectPath,
      ctx.feature,
      ctx.abortController.signal
    );
    const {
      projectPath,
      featureId,
      feature,
      steps,
      abortController,
      autoLoadClaudeMd,
      useClaudeCodeSystemPrompt,
    } = ctx;
    const workDir = remote?.binding.cwd ?? ctx.workDir;
    const prompts = await getPromptCustomization(this.settingsService, '[AutoMode]');
    const contextResult = remote
      ? await remoteService!.context(remote, abortController.signal)
      : await this.loadContextFilesFn({
          projectPath,
          fsModule: localFilesystem as Parameters<typeof loadContextFiles>[0]['fsModule'],
          taskContext: { title: feature.title ?? '', description: feature.description ?? '' },
        });
    const contextFilesPrompt = filterClaudeMdFromContext(
      contextResult,
      !remote && autoLoadClaudeMd && !isDirectModel(feature.model)
    );
    const recordRemoteMemoryUsage = async (success: boolean) => {
      if (!remote || !contextResult.memoryFiles.length) return;
      try {
        await remoteService!
          .memory(remote)
          .recordUsage(contextResult.memoryFiles, previousContext, success, abortController.signal);
      } catch (error) {
        logger.warn(
          'Pipeline target memory statistics were not saved (no replay/fallback):',
          error
        );
      }
    };
    const contextPath = path.join(getFeatureDir(projectPath, featureId), 'agent-output.md');
    let previousContext = '';
    try {
      previousContext = (await this.filesystem.readFile(contextPath, 'utf-8')) as string;
    } catch {
      /* */
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (abortController.signal.aborted) throw new Error('Pipeline execution aborted');
      await this.writeStatus(run, projectPath, featureId, `pipeline_${step.id}`);
      this.eventBus.emitAutoModeEvent('auto_mode_progress', {
        featureId,
        branchName: feature.branchName ?? null,
        content: `Starting pipeline step ${i + 1}/${steps.length}: ${step.name}`,
        projectPath,
      });
      this.eventBus.emitAutoModeEvent('pipeline_step_started', {
        featureId,
        stepId: step.id,
        stepName: step.name,
        stepIndex: i,
        totalSteps: steps.length,
        projectPath,
      });
      const model = resolveModelString(feature.model, DEFAULT_MODELS.claude);
      const currentStatus = `pipeline_${step.id}`;
      await this.runAgentFn(
        workDir,
        featureId,
        this.buildPipelineStepPrompt(step, feature, previousContext, prompts.taskExecution),
        abortController,
        projectPath,
        undefined,
        model,
        {
          projectPath,
          planningMode: 'skip',
          runPort: run
            ? this.concurrencyManager.coordinator.bind(this.concurrencyManager, run)
            : undefined,
          boundTargetCwd: remote?.binding.cwd ?? ctx.boundTargetCwd,
          requirePlanApproval: false,
          previousContent: previousContext,
          systemPrompt: contextFilesPrompt || undefined,
          autoLoadClaudeMd,
          useClaudeCodeSystemPrompt,
          thinkingLevel: feature.thinkingLevel,
          reasoningEffort: feature.reasoningEffort,
          status: currentStatus,
          providerId: feature.providerId,
        }
      );
      if (abortController.signal.aborted)
        throw new globalThis.DOMException('Pipeline execution aborted', 'AbortError');
      this.requireCurrent(run);
      try {
        previousContext = (await this.filesystem.readFile(contextPath, 'utf-8')) as string;
      } catch {
        /* */
      }
      this.requireCurrent(run);
      this.eventBus.emitAutoModeEvent('pipeline_step_complete', {
        featureId,
        stepId: step.id,
        stepName: step.name,
        stepIndex: i,
        totalSteps: steps.length,
        projectPath,
      });
    }
    if (ctx.branchName) {
      const mergeResult = await this.attemptMerge(ctx);
      if (!mergeResult.success && (mergeResult.hasConflicts || remote)) {
        if (remote) {
          await this.writeStatus(
            run,
            projectPath,
            featureId,
            mergeResult.hasConflicts ? 'merge_conflict' : 'waiting_approval'
          );
          this.eventBus.emitAutoModeEvent('auto_mode_progress', {
            featureId,
            projectPath,
            content: mergeResult.error || 'Remote integration needs review.',
          });
        }
        await recordRemoteMemoryUsage(false);
        return;
      }
    }
    await recordRemoteMemoryUsage(!feature.skipTests);
  }

  buildPipelineStepPrompt(
    step: PipelineStep,
    feature: Feature,
    previousContext: string,
    taskPrompts: { implementationInstructions: string; playwrightVerificationInstructions: string }
  ): string {
    let prompt = `## Pipeline Step: ${step.name}\n\nThis is an automated pipeline step.\n\n### Feature Context\n${this.buildFeaturePromptFn(feature, taskPrompts)}\n\n`;
    if (previousContext) prompt += `### Previous Work\n${previousContext}\n\n`;
    return (
      prompt +
      `### Pipeline Step Instructions\n${step.instructions}\n\n### Task\nComplete the pipeline step instructions above.\n\n` +
      `**CRITICAL: After completing the instructions, you MUST output a summary using this EXACT format:**\n\n` +
      `<summary>\n` +
      `## Summary: ${step.name}\n\n` +
      `### Changes Implemented\n` +
      `- [List all changes made in this step]\n\n` +
      `### Files Modified\n` +
      `- [List all files modified in this step]\n\n` +
      `### Outcome\n` +
      `- [Describe the result of this step]\n` +
      `</summary>\n\n` +
      `The <summary> and </summary> tags MUST be on their own lines. This is REQUIRED.`
    );
  }

  async detectPipelineStatus(
    projectPath: string,
    featureId: string,
    currentStatus: FeatureStatusWithPipeline
  ): Promise<PipelineStatusInfo> {
    const isPipeline = this.pipeline.isPipelineStatus(currentStatus);
    if (!isPipeline)
      return {
        isPipeline: false,
        stepId: null,
        stepIndex: -1,
        totalSteps: 0,
        step: null,
        config: null,
      };
    const stepId = this.pipeline.getStepIdFromStatus(currentStatus);
    if (!stepId)
      return {
        isPipeline: true,
        stepId: null,
        stepIndex: -1,
        totalSteps: 0,
        step: null,
        config: null,
      };
    const config = await this.pipeline.getPipelineConfig(projectPath);
    if (!config || config.steps.length === 0)
      return { isPipeline: true, stepId, stepIndex: -1, totalSteps: 0, step: null, config: null };
    const sortedSteps = [...config.steps].sort((a, b) => a.order - b.order);
    const stepIndex = sortedSteps.findIndex((s) => s.id === stepId);
    return {
      isPipeline: true,
      stepId,
      stepIndex,
      totalSteps: sortedSteps.length,
      step: stepIndex === -1 ? null : sortedSteps[stepIndex],
      config,
    };
  }

  async resumePipeline(
    projectPath: string,
    feature: Feature,
    useWorktrees: boolean,
    pipelineInfo: PipelineStatusInfo,
    expected?: RunningFeature
  ): Promise<void> {
    const run = expected ?? this.concurrencyManager.getRunningFeature(feature.id);
    this.requireCurrent(run);
    if (this.settingsService)
      await new FeatureWorkspaceService(this.settingsService).prepare(
        projectPath,
        feature,
        run?.abortController.signal ?? new AbortController().signal
      );
    const featureId = feature.id;
    const contextPath = path.join(getFeatureDir(projectPath, featureId), 'agent-output.md');
    let hasContext = false;
    try {
      await this.filesystem.access(contextPath);
      hasContext = true;
    } catch {
      /* No context */
    }

    if (!hasContext) {
      logger.warn(`No context for feature ${featureId}, restarting pipeline`);
      await this.writeStatus(run, projectPath, featureId, 'in_progress');
      return this.executeFeatureFn(projectPath, featureId, useWorktrees, false, undefined, {
        _calledInternally: true,
        _run: run,
      });
    }

    if (pipelineInfo.stepIndex === -1) {
      logger.warn(`Step ${pipelineInfo.stepId} no longer exists, completing feature`);
      const finalStatus = feature.skipTests ? 'waiting_approval' : 'verified';
      await this.writeStatus(run, projectPath, featureId, finalStatus);
      if (this.canComplete(run)) {
        this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
          featureId,
          featureName: feature.title,
          branchName: feature.branchName ?? null,
          executionMode: 'auto',
          passes: true,
          message: 'Pipeline step no longer exists',
          projectPath,
        });
      }
      return;
    }

    if (!pipelineInfo.config) throw new Error('Pipeline config is null but stepIndex is valid');
    return this.resumeFromStep(
      projectPath,
      feature,
      useWorktrees,
      pipelineInfo.stepIndex,
      pipelineInfo.config,
      run
    );
  }

  /** Resume from a specific step index */
  async resumeFromStep(
    projectPath: string,
    feature: Feature,
    useWorktrees: boolean,
    startFromStepIndex: number,
    pipelineConfig: PipelineConfig,
    expected?: RunningFeature
  ): Promise<void> {
    let run = expected ?? this.concurrencyManager.getRunningFeature(feature.id);
    const remoteService = this.settingsService
      ? new FeatureWorkspaceService(this.settingsService)
      : undefined;
    const featureId = feature.id;
    const allSortedSteps = [...pipelineConfig.steps].sort((a, b) => a.order - b.order);
    if (startFromStepIndex < 0 || startFromStepIndex >= allSortedSteps.length)
      throw new Error(`Invalid step index: ${startFromStepIndex}`);

    const excludedStepIds = new Set(feature.excludedPipelineSteps || []);
    let currentStep = allSortedSteps[startFromStepIndex];

    if (excludedStepIds.has(currentStep.id)) {
      const nextStatus = this.pipeline.getNextStatus(
        `pipeline_${currentStep.id}`,
        pipelineConfig,
        feature.skipTests ?? false,
        feature.excludedPipelineSteps
      );
      if (!this.pipeline.isPipelineStatus(nextStatus)) {
        await this.writeStatus(run, projectPath, featureId, nextStatus);
        if (this.canComplete(run)) {
          this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
            featureId,
            featureName: feature.title,
            branchName: feature.branchName ?? null,
            executionMode: 'auto',
            passes: true,
            message: 'Pipeline completed (remaining steps excluded)',
            projectPath,
          });
        }
        return;
      }
      const nextStepId = this.pipeline.getStepIdFromStatus(nextStatus);
      const nextStepIndex = allSortedSteps.findIndex((s) => s.id === nextStepId);
      if (nextStepIndex === -1) throw new Error(`Next step ${nextStepId} not found`);
      startFromStepIndex = nextStepIndex;
    }

    const stepsToExecute = allSortedSteps
      .slice(startFromStepIndex)
      .filter((step) => !excludedStepIds.has(step.id));
    if (stepsToExecute.length === 0) {
      const finalStatus = feature.skipTests ? 'waiting_approval' : 'verified';
      await this.writeStatus(run, projectPath, featureId, finalStatus);
      if (this.canComplete(run)) {
        this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
          featureId,
          featureName: feature.title,
          branchName: feature.branchName ?? null,
          executionMode: 'auto',
          passes: true,
          message: 'Pipeline completed (all steps excluded)',
          projectPath,
        });
      }
      return;
    }

    const runningEntry = await this.concurrencyManager.acquireAsync({
      featureId,
      projectPath,
      isAutoMode: false,
      allowReuse: true,
      expected: run,
    });
    run = runningEntry;
    const abortController = runningEntry.abortController;
    runningEntry.branchName = feature.branchName ?? null;
    let pipelineCompleted = false;

    try {
      const remote = await remoteService?.prepare(projectPath, feature, abortController.signal);
      runningEntry.remoteWorkspace = !!remote;
      this.directoryValidator(projectPath);
      let worktreePath: string | null = null;
      const branchName = feature.branchName;

      if (!remote && useWorktrees && branchName) {
        worktreePath = await this.worktreeResolver.findWorktreeForBranch(projectPath, branchName);
        if (worktreePath) logger.info(`Using worktree for branch "${branchName}": ${worktreePath}`);
      }

      const workDir =
        remote?.binding.cwd ??
        (worktreePath ? path.resolve(worktreePath) : path.resolve(projectPath));
      if (!remote) this.directoryValidator(workDir);
      runningEntry.worktreePath = remote?.environment.cwd ?? worktreePath;
      runningEntry.branchName =
        (remote?.binding.sshWorkspace ?? remote?.binding.featureWorkspace)?.baseBranch ??
        branchName ??
        null;

      this.eventBus.emitAutoModeEvent('auto_mode_feature_start', {
        featureId,
        projectPath,
        branchName: branchName ?? null,
        feature: {
          id: featureId,
          title: feature.title || 'Resuming Pipeline',
          description: feature.description,
        },
      });

      const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(
        projectPath,
        this.settingsService,
        '[AutoMode]'
      );
      const useClaudeCodeSystemPrompt = await getUseClaudeCodeSystemPromptSetting(
        projectPath,
        this.settingsService,
        '[AutoMode]'
      );
      const context: PipelineContext = {
        run: runningEntry,
        projectPath,
        featureId,
        feature,
        steps: stepsToExecute,
        workDir,
        boundTargetCwd: remote?.binding.cwd,
        worktreePath,
        branchName: branchName ?? null,
        abortController,
        autoLoadClaudeMd,
        useClaudeCodeSystemPrompt,
        testAttempts: 0,
        maxTestAttempts: 5,
      };

      await this.executePipeline(context);
      pipelineCompleted = true;

      // Re-fetch feature to check if executePipeline set a terminal status (e.g., merge_conflict)
      const reloadedFeature = await this.featureStateManager.loadFeature(projectPath, featureId);
      const finalStatus = feature.skipTests ? 'waiting_approval' : 'verified';

      // Only update status if not already in a terminal state
      if (
        reloadedFeature &&
        reloadedFeature.status !== 'merge_conflict' &&
        !(remote && reloadedFeature.status === 'waiting_approval')
      ) {
        await this.writeStatus(run, projectPath, featureId, finalStatus);
      }
      logger.info(`Pipeline resume completed for feature ${featureId}`);
      if (this.canComplete(runningEntry)) {
        this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
          featureId,
          featureName: feature.title,
          branchName: feature.branchName ?? null,
          executionMode: 'auto',
          passes: true,
          message: 'Pipeline resumed successfully',
          projectPath,
        });
      }
    } catch (error) {
      if (!this.concurrencyManager.isCurrent(runningEntry)) return;
      const errorInfo = classifyError(error);
      if (errorInfo.isAbort) {
        if (this.canComplete(runningEntry)) {
          this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
            featureId,
            featureName: feature.title,
            branchName: feature.branchName ?? null,
            executionMode: 'auto',
            passes: false,
            message: 'Pipeline stopped by user',
            projectPath,
          });
        }
      } else {
        // If pipeline steps completed successfully, don't send the feature back to backlog.
        // The pipeline work is done — set to waiting_approval so the user can review.
        const fallbackStatus = pipelineCompleted ? 'waiting_approval' : 'backlog';
        if (pipelineCompleted) {
          logger.info(
            `[resumeFromStep] Feature ${featureId} failed after pipeline completed. ` +
              `Setting status to waiting_approval instead of backlog to preserve pipeline work.`
          );
        }
        logger.error(`Pipeline resume failed for ${featureId}:`, error);
        // Don't overwrite terminal states like 'merge_conflict' that were set during pipeline execution
        const currentFeature = await this.featureStateManager.loadFeature(projectPath, featureId);
        if (currentFeature?.status !== 'merge_conflict') {
          await this.writeStatus(run, projectPath, featureId, fallbackStatus);
        }
        this.eventBus.emitAutoModeEvent('auto_mode_error', {
          featureId,
          featureName: feature.title,
          branchName: feature.branchName ?? null,
          error: errorInfo.message,
          errorType: errorInfo.type,
          projectPath,
        });
      }
    } finally {
      this.concurrencyManager.release(featureId, { expected: runningEntry });
    }
  }

  /** Execute test step with agent fix loop (REQ-F07) */
  async executeTestStep(context: PipelineContext, testCommand: string): Promise<StepResult> {
    const runPort = context.run
      ? this.concurrencyManager.coordinator.bind(this.concurrencyManager, context.run)
      : undefined;
    runPort?.transition('testing');
    const { featureId, projectPath, workDir, abortController, maxTestAttempts } = context;

    for (let attempt = 1; attempt <= maxTestAttempts; attempt++) {
      runPort?.transition('testing');
      if (abortController.signal.aborted)
        return { success: false, message: 'Test execution aborted' };
      logger.info(`Running tests for ${featureId} (attempt ${attempt}/${maxTestAttempts})`);

      let scrollback: string;
      if (
        isDirectModel(context.feature.model) ||
        (this.settingsService &&
          ((await hasRemoteEnvironment(
            this.settingsService,
            projectPath,
            `feature:${projectPath}:${featureId}`
          )) ||
            !!(
              await new EnvironmentBindingStore(this.settingsService).peek(
                projectPath,
                `feature:${projectPath}:${featureId}`
              )
            )?.featureWorkspace))
      ) {
        try {
          const sandbox = await runDirectShellCommand(
            this.settingsService,
            workDir,
            testCommand,
            abortController.signal,
            { projectPath, runKey: `feature:${projectPath}:${featureId}` }
          );
          this.eventBus.emitAutoModeEvent('auto_mode_progress', {
            featureId,
            projectPath,
            content: sandbox.output,
          });
          if (sandbox.exitCode === 0) return { success: true, testsPassed: true };
          scrollback = sandbox.output;
        } catch (error) {
          return {
            success: false,
            testsPassed: false,
            message: error instanceof Error ? error.message : 'Direct sandbox tests failed.',
          };
        }
      } else {
        const testResult = await this.testRunnerService.startTests(workDir, {
          command: testCommand,
        });
        if (!testResult.success || !testResult.result?.sessionId)
          return {
            success: false,
            testsPassed: false,
            message: testResult.error || 'Failed to start tests',
          };
        const completionResult = await this.waitForTestCompletion(
          testResult.result.sessionId,
          abortController.signal,
          context.feature.model
        );
        if (completionResult.status === 'passed') return { success: true, testsPassed: true };
        const sessionOutput = this.testRunnerService.getSessionOutput(testResult.result.sessionId);
        scrollback = sessionOutput.result?.output || '';
      }
      this.eventBus.emitAutoModeEvent('pipeline_test_failed', {
        featureId,
        attempt,
        maxAttempts: maxTestAttempts,
        failedTests: this.extractFailedTestNames(scrollback),
        projectPath,
      });

      if (attempt < maxTestAttempts) {
        const fixPrompt = `## Test Failures - Please Fix\n\n${this.buildTestFailureSummary(scrollback)}\n\nFix the failing tests without modifying test code unless clearly wrong.`;
        await this.runAgentFn(
          workDir,
          featureId,
          fixPrompt,
          abortController,
          projectPath,
          undefined,
          resolveModelString(context.feature.model, DEFAULT_MODELS.claude),
          {
            projectPath,
            planningMode: 'skip',
            runPort,
            requirePlanApproval: false,
            useClaudeCodeSystemPrompt: context.useClaudeCodeSystemPrompt,
            autoLoadClaudeMd: context.autoLoadClaudeMd,
            thinkingLevel: context.feature.thinkingLevel,
            reasoningEffort: context.feature.reasoningEffort,
            status: context.feature.status,
            providerId: context.feature.providerId,
            boundTargetCwd: context.boundTargetCwd,
            branchName: context.feature.branchName,
          }
        );
      }
    }
    return {
      success: false,
      testsPassed: false,
      message: `Tests failed after ${maxTestAttempts} attempts`,
    };
  }

  /** Wait for test completion */
  private async waitForTestCompletion(
    sessionId: string,
    signal: AbortSignal,
    model?: string
  ): Promise<{ status: TestRunStatus; exitCode: number | null; duration: number }> {
    const timeoutMs = modelTimeout(
      providerModelTimeouts(
        await this.settingsService?.getGlobalSettings(),
        getModelProvider(model)
      ),
      'pipelineTestTimeoutMs'
    );
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // Check for abort
        if (signal.aborted) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve({ status: 'failed', exitCode: null, duration: 0 });
          return;
        }

        const session = this.testRunnerService.getSession(sessionId);
        if (session && session.status !== 'running' && session.status !== 'pending') {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve({
            status: session.status,
            exitCode: session.exitCode,
            duration: session.finishedAt
              ? session.finishedAt.getTime() - session.startedAt.getTime()
              : 0,
          });
        }
      }, 1000);
      const timeoutId = setTimeout(() => {
        // Check for abort before timeout resolution
        if (signal.aborted) {
          clearInterval(checkInterval);
          resolve({ status: 'failed', exitCode: null, duration: 0 });
          return;
        }
        clearInterval(checkInterval);
        resolve({ status: 'failed', exitCode: null, duration: timeoutMs });
      }, timeoutMs);
    });
  }

  /** Attempt to merge feature branch (REQ-F05) */
  async attemptMerge(context: PipelineContext): Promise<MergeResult> {
    const run = context.run ?? this.concurrencyManager.getRunningFeature(context.featureId);
    this.requireCurrent(run);
    const { projectPath, featureId, branchName, worktreePath, feature } = context;
    if (!branchName) return { success: false, error: 'No branch name for merge' };
    if (this.settingsService) {
      const service = new FeatureWorkspaceService(this.settingsService);
      try {
        const remote = await service.prepare(
          projectPath,
          feature,
          context.abortController.signal,
          false
        );
        if (remote) {
          await service.merge(remote, context.abortController.signal);
          return { success: true };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Remote merge failed; inspect state.',
        };
      }
    }

    logger.info(`Attempting auto-merge for feature ${featureId} (branch: ${branchName})`);
    try {
      // Get the primary branch dynamically instead of hardcoding 'main'
      const targetBranch = await this.worktreeResolver.getCurrentBranch(projectPath);

      // Call merge service directly instead of HTTP fetch
      const result = await performMerge(
        projectPath,
        branchName,
        worktreePath || projectPath,
        targetBranch || 'main',
        {
          deleteWorktreeAndBranch: false,
        },
        this.eventBus.getUnderlyingEmitter()
      );

      this.requireCurrent(run);
      if (!result.success) {
        if (result.hasConflicts) {
          await this.writeStatus(run, projectPath, featureId, 'merge_conflict');
          this.eventBus.emitAutoModeEvent('pipeline_merge_conflict', {
            featureId,
            branchName,
            projectPath,
          });
          return { success: false, hasConflicts: true, needsAgentResolution: true };
        }
        return { success: false, error: result.error };
      }

      logger.info(`Auto-merge successful for feature ${featureId}`);
      if (this.canComplete(run)) {
        this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
          featureId,
          featureName: feature.title,
          branchName,
          executionMode: 'auto',
          passes: true,
          message: 'Pipeline completed and merged',
          projectPath,
        });
      }
      return { success: true };
    } catch (error) {
      logger.error(`Merge failed for ${featureId}:`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  /** Shared helper to parse test output lines and extract failure information */
  private parseTestLines(scrollback: string): {
    failedTests: string[];
    passCount: number;
    failCount: number;
  } {
    const lines = scrollback.split('\n');
    const failedTests: string[] = [];
    let passCount = 0;
    let failCount = 0;

    let inFailureContext = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes('FAIL') || trimmed.includes('FAILED')) {
        const match = trimmed.match(/(?:FAIL|FAILED)\s+(.+)/);
        if (match) failedTests.push(match[1].trim());
        failCount++;
        inFailureContext = true;
      } else if (trimmed.includes('PASS') || trimmed.includes('PASSED')) {
        passCount++;
        inFailureContext = false;
      }
      if (trimmed.match(/^>\s+.*\.(test|spec)\./)) {
        failedTests.push(trimmed.replace(/^>\s+/, ''));
      }
      // Only capture assertion details when they appear in failure context
      // or match explicit assertion error / expect patterns
      if (trimmed.includes('AssertionError')) {
        failedTests.push(trimmed);
      } else if (
        inFailureContext &&
        /expect\(.+\)\.(toBe|toEqual|toMatch|toThrow|toContain)\s*\(/.test(trimmed)
      ) {
        failedTests.push(trimmed);
      } else if (
        inFailureContext &&
        (trimmed.startsWith('Expected') || trimmed.startsWith('Received'))
      ) {
        failedTests.push(trimmed);
      }
    }

    return { failedTests, passCount, failCount };
  }

  /** Build a concise test failure summary for the agent */
  buildTestFailureSummary(scrollback: string): string {
    const { failedTests, passCount, failCount } = this.parseTestLines(scrollback);
    const unique = [...new Set(failedTests)].slice(0, 10);
    return `Test Results: ${passCount} passed, ${failCount} failed.\n\nFailed tests:\n${unique.map((t) => `- ${t}`).join('\n')}\n\nOutput (last 2000 chars):\n${scrollback.slice(-2000)}`;
  }

  /** Extract failed test names from scrollback */
  private extractFailedTestNames(scrollback: string): string[] {
    const { failedTests } = this.parseTestLines(scrollback);
    return [...new Set(failedTests)].slice(0, 20);
  }
}
