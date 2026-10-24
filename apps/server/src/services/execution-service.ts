/**
 * ExecutionService - Feature execution lifecycle coordination
 */

import path from 'path';
import type { Feature } from '@automaker/types';
import { isDirectModel } from '@automaker/types';
import { createLogger, classifyError, loadContextFiles, recordMemoryUsage } from '@automaker/utils';
import { resolveModelString, DEFAULT_MODELS } from '@automaker/model-resolver';
import { getFeatureDir } from '@automaker/platform';
import type { ProviderRegistry } from '../modules/providers/provider-registry.service.js';
import * as secureFs from '../lib/secure-fs.js';
import {
  getPromptCustomization,
  getAutoLoadClaudeMdSetting,
  getUseClaudeCodeSystemPromptSetting,
  filterClaudeMdFromContext,
} from '../lib/settings-helpers.js';
import { validateWorkingDirectory } from '../lib/sdk-options.js';
import { extractSummary } from './spec-parser.js';
import type { TypedEventBus } from './typed-event-bus.js';
import type { ConcurrencyManager, RunningFeature } from './concurrency-manager.js';
import type { WorktreeResolver } from './worktree-resolver.js';
import type { SettingsService } from './settings-service.js';
import { pipelineService, type PipelineService } from './pipeline-service.js';
import { FeatureWorkspaceService } from './execution-environment/feature-workspace.js';

// Re-export callback types from execution-types.ts for backward compatibility
export type {
  RunAgentFn,
  ExecutePipelineFn,
  UpdateFeatureStatusFn,
  LoadFeatureFn,
  GetPlanningPromptPrefixFn,
  SaveFeatureSummaryFn,
  RecordLearningsFn,
  ContextExistsFn,
  ResumeFeatureFn,
  TrackFailureFn,
  SignalPauseFn,
  RecordSuccessFn,
  SaveExecutionStateFn,
  LoadContextFilesFn,
} from './execution-types.js';

import type {
  RunAgentFn,
  ExecutePipelineFn,
  UpdateFeatureStatusFn,
  LoadFeatureFn,
  GetPlanningPromptPrefixFn,
  SaveFeatureSummaryFn,
  RecordLearningsFn,
  ContextExistsFn,
  ResumeFeatureFn,
  TrackFailureFn,
  SignalPauseFn,
  RecordSuccessFn,
  SaveExecutionStateFn,
  LoadContextFilesFn,
} from './execution-types.js';

const logger = createLogger('ExecutionService');

/** Marker written by agent-executor for each tool invocation. */
const TOOL_USE_MARKER = '🔧 Tool:';

/** Minimum trimmed output length to consider agent work meaningful. */
const MIN_MEANINGFUL_OUTPUT_LENGTH = 200;

export class ExecutionService {
  constructor(
    private eventBus: TypedEventBus,
    private concurrencyManager: ConcurrencyManager,
    private worktreeResolver: WorktreeResolver,
    private settingsService: SettingsService | null,
    // Callback dependencies for delegation
    private runAgentFn: RunAgentFn,
    private executePipelineFn: ExecutePipelineFn,
    private updateFeatureStatusFn: UpdateFeatureStatusFn,
    private loadFeatureFn: LoadFeatureFn,
    private getPlanningPromptPrefixFn: GetPlanningPromptPrefixFn,
    private saveFeatureSummaryFn: SaveFeatureSummaryFn,
    private recordLearningsFn: RecordLearningsFn,
    private contextExistsFn: ContextExistsFn,
    private resumeFeatureFn: ResumeFeatureFn,
    private trackFailureFn: TrackFailureFn,
    private signalPauseFn: SignalPauseFn,
    private recordSuccessFn: RecordSuccessFn,
    private saveExecutionStateFn: SaveExecutionStateFn,
    private loadContextFilesFn: LoadContextFilesFn,
    private readonly providerRegistry: ProviderRegistry,
    private readonly pipeline: PipelineService = pipelineService,
    private readonly directoryValidator: (cwd: string) => void = validateWorkingDirectory
  ) {}

  private acquireRunningFeature(options: {
    featureId: string;
    projectPath: string;
    isAutoMode: boolean;
    allowReuse?: boolean;
    expected?: RunningFeature;
  }): Promise<RunningFeature> {
    return this.concurrencyManager.acquireAsync(options);
  }

  private releaseRunningFeature(
    featureId: string,
    options?: { force?: boolean; expected?: RunningFeature }
  ): void {
    this.concurrencyManager.release(featureId, options);
  }

  private extractTitleFromDescription(description: string | undefined): string {
    if (!description?.trim()) return 'Untitled Feature';
    const firstLine = description.split('\n')[0].trim();
    return firstLine.length <= 60 ? firstLine : firstLine.substring(0, 57) + '...';
  }

  /**
   * Build feature description section (without implementation instructions).
   * Used when planning mode is active — the planning prompt provides its own instructions.
   */
  buildFeatureDescription(feature: Feature): string {
    const title = this.extractTitleFromDescription(feature.description);

    let prompt = `## Feature Task

**Feature ID:** ${feature.id}
**Title:** ${title}
**Description:** ${feature.description}
`;

    if (feature.spec) {
      prompt += `
**Specification:**
${feature.spec}
`;
    }

    if (feature.imagePaths && feature.imagePaths.length > 0) {
      const imagesList = feature.imagePaths
        .map((img, idx) => {
          const imgPath = typeof img === 'string' ? img : img.path;
          const filename =
            typeof img === 'string'
              ? imgPath.split('/').pop()
              : img.filename || imgPath.split('/').pop();
          const mimeType = typeof img === 'string' ? 'image/*' : img.mimeType || 'image/*';
          return `   ${idx + 1}. ${filename} (${mimeType})\n      Path: ${imgPath}`;
        })
        .join('\n');
      prompt += `\n**Context Images Attached:**\n${feature.imagePaths.length} image(s) attached:\n${imagesList}\n`;
    }

    return prompt;
  }

  buildFeaturePrompt(
    feature: Feature,
    taskExecutionPrompts: {
      implementationInstructions: string;
      playwrightVerificationInstructions: string;
    }
  ): string {
    let prompt = this.buildFeatureDescription(feature);

    prompt += feature.skipTests
      ? `\n${taskExecutionPrompts.implementationInstructions}`
      : `\n${taskExecutionPrompts.implementationInstructions}\n\n${taskExecutionPrompts.playwrightVerificationInstructions}`;
    return prompt;
  }

  async executeFeature(
    projectPath: string,
    featureId: string,
    useWorktrees = false,
    isAutoMode = false,
    providedWorktreePath?: string,
    options?: { continuationPrompt?: string; _calledInternally?: boolean; _run?: RunningFeature }
  ): Promise<void> {
    const tempRunningFeature = await this.acquireRunningFeature({
      featureId,
      projectPath,
      isAutoMode,
      allowReuse: options?._calledInternally,
      expected: options?._run,
    });
    const abortController = tempRunningFeature.abortController;
    const current = () => this.concurrencyManager.isCurrent(tempRunningFeature);
    const updateStatus = (status: string) =>
      this.concurrencyManager.coordinator.status(
        this.concurrencyManager,
        tempRunningFeature,
        status,
        () => this.updateFeatureStatusFn(projectPath, featureId, status)
      );
    if (isAutoMode) await this.saveExecutionStateFn(projectPath);
    let feature: Feature | null = null;
    let pipelineCompleted = false;

    try {
      this.directoryValidator(projectPath);
      feature = await this.loadFeatureFn(projectPath, featureId);
      if (!feature) throw new Error(`Feature ${featureId} not found`);
      const remoteService = this.settingsService
        ? new FeatureWorkspaceService(this.settingsService)
        : undefined;
      const remote = await remoteService?.prepare(projectPath, feature, abortController.signal);
      tempRunningFeature.remoteWorkspace = !!remote;
      if (
        remote &&
        providedWorktreePath &&
        path.resolve(providedWorktreePath) !== path.resolve(projectPath)
      )
        throw new Error(
          'Managed features use their pinned workspace, not a supplied controller worktree path.'
        );

      // Update status to in_progress immediately after acquiring the feature.
      // This prevents a race condition where the UI reloads features and sees the
      // feature still in 'backlog' status while it's actually being executed.
      // Only do this for the initial call (not internal/recursive calls which would
      // redundantly update the status).
      if (
        !options?._calledInternally &&
        (feature.status === 'backlog' ||
          feature.status === 'ready' ||
          feature.status === 'interrupted')
      ) {
        if (!(await updateStatus('in_progress'))) return;
      }

      if (!options?.continuationPrompt) {
        if (feature.planSpec?.status === 'approved') {
          const prompts = await getPromptCustomization(this.settingsService, '[ExecutionService]');
          let continuationPrompt = prompts.taskExecution.continuationAfterApprovalTemplate;
          continuationPrompt = continuationPrompt
            .replace(/\{\{userFeedback\}\}/g, '')
            .replace(/\{\{approvedPlan\}\}/g, feature.planSpec.content || '');
          return await this.executeFeature(
            projectPath,
            featureId,
            useWorktrees,
            isAutoMode,
            providedWorktreePath,
            { continuationPrompt, _calledInternally: true, _run: tempRunningFeature }
          );
        }
        if (await this.contextExistsFn(projectPath, featureId)) {
          return await this.resumeFeatureFn(
            projectPath,
            featureId,
            useWorktrees,
            true,
            tempRunningFeature
          );
        }
      }

      let worktreePath: string | null = remote ? null : (providedWorktreePath ?? null);
      const branchName = feature.branchName;
      if (!remote && !worktreePath && useWorktrees && branchName) {
        worktreePath = await this.worktreeResolver.findWorktreeForBranch(projectPath, branchName);
        if (!worktreePath) {
          throw new Error(
            `Worktree enabled but no worktree found for feature branch "${branchName}".`
          );
        }
        logger.info(`Using worktree for branch "${branchName}": ${worktreePath}`);
      }
      const workDir = remote
        ? remote.binding.cwd
        : worktreePath
          ? path.resolve(worktreePath)
          : path.resolve(projectPath);
      if (!remote) this.directoryValidator(workDir);
      tempRunningFeature.worktreePath = remote?.environment.cwd ?? worktreePath;
      tempRunningFeature.branchName =
        (remote?.binding.sshWorkspace ?? remote?.binding.featureWorkspace)?.baseBranch ??
        branchName ??
        null;
      // Ensure status is in_progress (may already be set from the early update above,
      // but internal/recursive calls skip the early update and need it here).
      // Mirror the external guard: only transition when the feature is still in
      // backlog, ready, or interrupted to avoid overwriting a concurrent terminal status.
      if (
        options?._calledInternally &&
        (feature.status === 'backlog' ||
          feature.status === 'ready' ||
          feature.status === 'interrupted')
      ) {
        if (!(await updateStatus('in_progress'))) return;
      }
      this.eventBus.emitAutoModeEvent('auto_mode_feature_start', {
        featureId,
        projectPath,
        ...(remote && { executionEnvironment: remote.binding }),
        branchName: feature.branchName ?? null,
        feature: {
          id: featureId,
          title: feature.title || 'Loading...',
          description: feature.description || 'Feature is starting',
        },
      });

      const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(
        projectPath,
        this.settingsService,
        '[ExecutionService]'
      );
      const useClaudeCodeSystemPrompt = await getUseClaudeCodeSystemPromptSetting(
        projectPath,
        this.settingsService,
        '[ExecutionService]'
      );
      const prompts = await getPromptCustomization(this.settingsService, '[ExecutionService]');
      let prompt: string;
      const contextResult = remote
        ? await remoteService!.context(remote, abortController.signal)
        : await this.loadContextFilesFn({
            projectPath,
            fsModule: secureFs as Parameters<typeof loadContextFiles>[0]['fsModule'],
            taskContext: {
              title: feature.title ?? '',
              description: feature.description ?? '',
            },
          });
      const combinedSystemPrompt = filterClaudeMdFromContext(
        contextResult,
        !remote && autoLoadClaudeMd && !isDirectModel(feature.model)
      );

      if (options?.continuationPrompt) {
        prompt = options.continuationPrompt;
      } else {
        const planningPrefix = await this.getPlanningPromptPrefixFn(feature);
        if (planningPrefix) {
          // Planning mode active: use planning instructions + feature description only.
          // Do NOT include implementationInstructions — they conflict with the planning
          // prompt's "DO NOT proceed with implementation until approval" directive.
          prompt = planningPrefix + '\n\n' + this.buildFeatureDescription(feature);
        } else {
          prompt = this.buildFeaturePrompt(feature, prompts.taskExecution);
        }
        if (feature.planningMode && feature.planningMode !== 'skip') {
          this.eventBus.emitAutoModeEvent('planning_started', {
            featureId: feature.id,
            mode: feature.planningMode,
            message: `Starting ${feature.planningMode} planning phase`,
          });
        }
      }

      const imagePaths = feature.imagePaths?.map((img) =>
        typeof img === 'string' ? img : img.path
      );
      const model = resolveModelString(feature.model, DEFAULT_MODELS.claude);
      tempRunningFeature.model = model;
      tempRunningFeature.provider = this.providerRegistry.providerNameForModel(model);

      await this.runAgentFn(
        workDir,
        featureId,
        prompt,
        abortController,
        projectPath,
        imagePaths,
        model,
        {
          projectPath,
          planningMode: feature.planningMode,
          boundTargetCwd: remote?.binding.cwd,
          requirePlanApproval: feature.requirePlanApproval,
          systemPrompt: combinedSystemPrompt || undefined,
          autoLoadClaudeMd,
          useClaudeCodeSystemPrompt,
          thinkingLevel: feature.thinkingLevel,
          reasoningEffort: feature.reasoningEffort,
          providerId: feature.providerId,
          branchName: feature.branchName ?? null,
        }
      );

      abortController.signal.throwIfAborted();
      // Check for incomplete tasks after agent execution.
      // The agent may have finished early (hit max turns, decided it was done, etc.)
      // while tasks are still pending. If so, re-run the agent to complete remaining tasks.
      const MAX_TASK_RETRY_ATTEMPTS = 3;
      let taskRetryAttempts = 0;
      while (!abortController.signal.aborted && taskRetryAttempts < MAX_TASK_RETRY_ATTEMPTS) {
        const currentFeature = await this.loadFeatureFn(projectPath, featureId);
        if (!currentFeature?.planSpec?.tasks) break;

        const pendingTasks = currentFeature.planSpec.tasks.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress'
        );
        if (pendingTasks.length === 0) break;

        taskRetryAttempts++;
        const totalTasks = currentFeature.planSpec.tasks.length;
        const completedTasks = currentFeature.planSpec.tasks.filter(
          (t) => t.status === 'completed'
        ).length;
        logger.info(
          `[executeFeature] Feature ${featureId} has ${pendingTasks.length} incomplete tasks (${completedTasks}/${totalTasks} completed). Re-running agent (attempt ${taskRetryAttempts}/${MAX_TASK_RETRY_ATTEMPTS})`
        );

        this.eventBus.emitAutoModeEvent('auto_mode_progress', {
          featureId,
          branchName: feature.branchName ?? null,
          content: `Agent finished with ${pendingTasks.length} tasks remaining. Re-running to complete tasks (attempt ${taskRetryAttempts}/${MAX_TASK_RETRY_ATTEMPTS})...`,
          projectPath,
        });

        // Build a continuation prompt that tells the agent to finish remaining tasks
        const remainingTasksList = pendingTasks
          .map((t) => `- ${t.id}: ${t.description} (${t.status})`)
          .join('\n');

        const continuationPrompt = `## Continue Implementation - Incomplete Tasks

The previous agent session ended before all tasks were completed. Please continue implementing the remaining tasks.

**Completed:** ${completedTasks}/${totalTasks} tasks
**Remaining tasks:**
${remainingTasksList}

Please continue from where you left off and complete all remaining tasks. Use the same [TASK_START:ID] and [TASK_COMPLETE:ID] markers for each task.`;

        await this.runAgentFn(
          workDir,
          featureId,
          continuationPrompt,
          abortController,
          projectPath,
          undefined,
          model,
          {
            projectPath,
            planningMode: 'skip',
            boundTargetCwd: remote?.binding.cwd,
            requirePlanApproval: false,
            systemPrompt: combinedSystemPrompt || undefined,
            autoLoadClaudeMd,
            useClaudeCodeSystemPrompt,
            thinkingLevel: feature.thinkingLevel,
            reasoningEffort: feature.reasoningEffort,
            providerId: feature.providerId,
            branchName: feature.branchName ?? null,
          }
        );
      }

      // Log if tasks are still incomplete after retry attempts
      if (taskRetryAttempts >= MAX_TASK_RETRY_ATTEMPTS) {
        const finalFeature = await this.loadFeatureFn(projectPath, featureId);
        const stillPending = finalFeature?.planSpec?.tasks?.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress'
        );
        if (stillPending && stillPending.length > 0) {
          logger.warn(
            `[executeFeature] Feature ${featureId} still has ${stillPending.length} incomplete tasks after ${MAX_TASK_RETRY_ATTEMPTS} retry attempts. Moving to final status.`
          );
        }
      }

      abortController.signal.throwIfAborted();
      const pipelineConfig = await this.pipeline.getPipelineConfig(projectPath);
      const excludedStepIds = new Set(feature.excludedPipelineSteps || []);
      const sortedSteps = [...(pipelineConfig?.steps || [])]
        .sort((a, b) => a.order - b.order)
        .filter((step) => !excludedStepIds.has(step.id));
      if (sortedSteps.length > 0) {
        await this.executePipelineFn({
          run: tempRunningFeature,
          projectPath,
          featureId,
          feature,
          steps: sortedSteps,
          workDir,
          worktreePath,
          branchName: feature.branchName ?? null,
          abortController,
          autoLoadClaudeMd,
          useClaudeCodeSystemPrompt,
          testAttempts: 0,
          maxTestAttempts: 5,
          boundTargetCwd: remote?.binding.cwd,
        });
        pipelineCompleted = true;
        // Check if pipeline set a terminal status (e.g., merge_conflict) — don't overwrite it
        const refreshed = await this.loadFeatureFn(projectPath, featureId);
        if (
          refreshed?.status === 'merge_conflict' ||
          (remote && refreshed?.status === 'waiting_approval')
        ) {
          return;
        }
      }

      // Read agent output before determining final status.
      // CLI-based providers (Cursor, Codex, etc.) may exit quickly without doing
      // meaningful work. Check output to avoid prematurely marking as 'verified'.
      const outputPath = path.join(getFeatureDir(projectPath, featureId), 'agent-output.md');
      let agentOutput = '';
      try {
        agentOutput = (await secureFs.readFile(outputPath, 'utf-8')) as string;
      } catch {
        /* */
      }

      // Determine if the agent did meaningful work by checking for tool usage
      // indicators in the output. The agent executor writes "🔧 Tool:" markers
      // each time a tool is invoked. No tool usage suggests the CLI exited
      // without performing implementation work.
      const hasToolUsage = agentOutput.includes(TOOL_USE_MARKER);
      const isOutputTooShort = agentOutput.trim().length < MIN_MEANINGFUL_OUTPUT_LENGTH;
      const agentDidWork = hasToolUsage && !isOutputTooShort;

      let finalStatus: 'verified' | 'waiting_approval';
      if (feature.skipTests) {
        finalStatus = 'waiting_approval';
      } else if (!agentDidWork) {
        // Agent didn't produce meaningful output (e.g., CLI exited quickly).
        // Route to waiting_approval so the user can review and re-run.
        finalStatus = 'waiting_approval';
        logger.warn(
          `[executeFeature] Feature ${featureId}: agent produced insufficient output ` +
            `(${agentOutput.trim().length}/${MIN_MEANINGFUL_OUTPUT_LENGTH} chars, toolUsage=${hasToolUsage}). ` +
            `Setting status to waiting_approval instead of verified.`
        );
      } else {
        finalStatus = 'verified';
      }

      if (!(await updateStatus(finalStatus))) return;
      if (!current()) return;
      this.recordSuccessFn();

      // Check final task completion state for accurate reporting
      const completedFeature = await this.loadFeatureFn(projectPath, featureId);
      const totalTasks = completedFeature?.planSpec?.tasks?.length ?? 0;
      const completedTasks =
        completedFeature?.planSpec?.tasks?.filter((t) => t.status === 'completed').length ?? 0;
      const hasIncompleteTasks = totalTasks > 0 && completedTasks < totalTasks;

      try {
        // Only save summary if feature doesn't already have one (e.g., accumulated from pipeline steps)
        // This prevents overwriting accumulated summaries with just the last step's output
        // The agent-executor already extracts and saves summaries during execution
        if (agentOutput && !completedFeature?.summary) {
          const summary = extractSummary(agentOutput);
          if (
            summary &&
            !(await this.concurrencyManager.coordinator.mutate(
              this.concurrencyManager,
              tempRunningFeature,
              () => this.saveFeatureSummaryFn(projectPath, featureId, summary)
            ))
          )
            return;
        }
        if (contextResult.memoryFiles.length > 0 && agentOutput) {
          if (remote)
            await remoteService!
              .memory(remote)
              .recordUsage(
                contextResult.memoryFiles,
                agentOutput,
                finalStatus === 'verified',
                abortController.signal
              );
          else
            await recordMemoryUsage(
              projectPath,
              contextResult.memoryFiles,
              agentOutput,
              true,
              secureFs as Parameters<typeof recordMemoryUsage>[4]
            );
        }
        if (remote)
          await this.recordLearningsFn(
            projectPath,
            feature,
            agentOutput,
            remoteService!.memory(remote).writer(abortController.signal)
          );
        else await this.recordLearningsFn(projectPath, feature, agentOutput);
      } catch (error) {
        logger.warn('Feature summary/memory recording failed (no replay/fallback):', error);
      }

      const elapsedSeconds = Math.round((Date.now() - tempRunningFeature.startTime) / 1000);
      let completionMessage = `Feature completed in ${elapsedSeconds}s`;
      if (finalStatus === 'verified') completionMessage += ' - auto-verified';
      if (hasIncompleteTasks)
        completionMessage += ` (${completedTasks}/${totalTasks} tasks completed)`;

      if (
        isAutoMode &&
        this.concurrencyManager.coordinator.acceptCompletion(
          this.concurrencyManager,
          tempRunningFeature,
          'execution-complete'
        )
      ) {
        this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
          featureId,
          featureName: feature.title,
          branchName: feature.branchName ?? null,
          executionMode: 'auto',
          passes: true,
          message: completionMessage,
          projectPath,
          model: tempRunningFeature.model,
          provider: tempRunningFeature.provider,
        });
      }
    } catch (error) {
      if (!current()) return;
      const errorInfo = classifyError(error);
      if (errorInfo.isAbort) {
        if (!(await updateStatus('interrupted'))) return;
        if (
          isAutoMode &&
          this.concurrencyManager.coordinator.acceptCompletion(
            this.concurrencyManager,
            tempRunningFeature,
            'execution-complete'
          )
        ) {
          this.eventBus.emitAutoModeEvent('auto_mode_feature_complete', {
            featureId,
            featureName: feature?.title,
            branchName: feature?.branchName ?? null,
            executionMode: 'auto',
            passes: false,
            message: 'Feature stopped by user',
            projectPath,
          });
        }
      } else {
        logger.error(`Feature ${featureId} failed:`, error);
        // If pipeline steps completed successfully, don't send the feature back to backlog.
        // The pipeline work is done — set to waiting_approval so the user can review.
        const fallbackStatus = pipelineCompleted ? 'waiting_approval' : 'backlog';
        if (pipelineCompleted) {
          logger.info(
            `[executeFeature] Feature ${featureId} failed after pipeline completed. ` +
              `Setting status to waiting_approval instead of backlog to preserve pipeline work.`
          );
        }
        // Don't overwrite terminal states like 'merge_conflict' that were set during pipeline execution
        let currentStatus: string | undefined;
        try {
          const currentFeature = await this.loadFeatureFn(projectPath, featureId);
          currentStatus = currentFeature?.status;
        } catch (loadErr) {
          // If loading fails, log it and proceed with the status update anyway
          logger.warn(
            `[executeFeature] Failed to reload feature ${featureId} for status check:`,
            loadErr
          );
        }
        if (currentStatus !== 'merge_conflict') {
          if (!(await updateStatus(fallbackStatus))) return;
        }
        if (!current()) return;
        this.eventBus.emitAutoModeEvent('auto_mode_error', {
          featureId,
          featureName: feature?.title,
          branchName: feature?.branchName ?? null,
          error: errorInfo.message,
          errorType: errorInfo.type,
          projectPath,
        });
        if (this.trackFailureFn({ type: errorInfo.type, message: errorInfo.message })) {
          this.signalPauseFn({ type: errorInfo.type, message: errorInfo.message });
        }
      }
    } finally {
      this.releaseRunningFeature(featureId, { expected: tempRunningFeature });
      if (isAutoMode && projectPath) await this.saveExecutionStateFn(projectPath);
    }
  }

  async stopFeature(featureId: string): Promise<boolean> {
    const running = this.concurrencyManager.getRunningFeature(featureId);
    if (!running) return false;
    const { projectPath } = running;

    // Immediately update feature status to 'interrupted' so the UI reflects
    // the stop right away. CLI-based providers can take seconds to terminate
    // their subprocess after the abort signal fires, leaving the feature stuck
    // in 'in_progress' on the Kanban board until the executeFeature catch block
    // eventually runs. By persisting and emitting the status change here, the
    // board updates immediately regardless of how long the subprocess takes to stop.
    try {
      await this.concurrencyManager.coordinator.status(
        this.concurrencyManager,
        running,
        'interrupted',
        () => this.updateFeatureStatusFn(projectPath, featureId, 'interrupted')
      );
    } catch (err) {
      // Non-fatal: the abort still proceeds and executeFeature's catch block
      // will attempt the same update once the subprocess terminates.
      logger.warn(`stopFeature: failed to immediately update status for ${featureId}:`, err);
    }

    running.abortController.abort();
    if (!running.remoteWorkspace)
      this.releaseRunningFeature(featureId, { force: true, expected: running });
    return true;
  }
}
