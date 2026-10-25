import type {
  AutoModeBranchInput,
  AutoModeCommitInput,
  AutoModeExecuteInput,
  AutoModeFeatureInput,
  AutoModeFollowUpInput,
  AutoModeMergeInput,
  AutoModeProjectInput,
  AutoModeStartInput,
  AutoModeStatusInput,
  AutoModeStopFeatureInput,
  PendingPlanApprovalInput,
  PlanApprovalDecisionInput,
} from './application.inputs.js';
import { FeatureMergeError } from './auto-mode.errors.js';
import { ProjectAnalysisService } from './project-analysis.service.js';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';

import {
  type AutoModeScheduler,
  type FeatureWorkflow,
  type AutoModeLifecycle,
} from './auto-mode.ports.js';
import { ProjectRunContextRegistry } from './project-run-context.registry.js';

import { ConflictDomainError } from '../../core/errors/domain-errors.js';

export class AutoModeApplicationService {
  constructor(
    private readonly scheduler: AutoModeScheduler,
    private readonly workflows: FeatureWorkflow,

    private readonly recovery: Pick<
      AutoModeLifecycle,
      'reconcileFeatureStates' | 'resumeInterruptedFeatures'
    >,
    private readonly contexts: ProjectRunContextRegistry,
    private readonly analysis: ProjectAnalysisService
  ) {}

  async start(input: AutoModeStartInput) {
    const project = this.contexts.canonicalProject(input.projectPath),
      branchName = input.branchName ?? null;
    const description = branchName ? `worktree ${branchName}` : 'main worktree';
    if (this.scheduler.isAutoLoopRunningForProject(project, branchName))
      return {
        success: true,
        message: `Auto mode is already running for ${description}`,
        alreadyRunning: true,
        branchName,
      };
    const concurrency = await this.scheduler.startAutoLoopForProject(
      project,
      branchName,
      input.maxConcurrency
    );
    return {
      success: true,
      message: `Auto mode started with max ${concurrency} concurrent features`,
      branchName,
    };
  }
  async stop(input: AutoModeBranchInput) {
    const project = this.contexts.canonicalProject(input.projectPath),
      branchName = input.branchName ?? null;
    const description = branchName ? `worktree ${branchName}` : 'main worktree';
    if (!this.scheduler.isAutoLoopRunningForProject(project, branchName))
      return {
        success: true,
        message: `Auto mode is not running for ${description}`,
        wasRunning: false,
        branchName,
      };
    return {
      success: true,
      message: 'Auto mode stopped',
      runningFeaturesCount: await this.scheduler.stopAutoLoopForProject(project, branchName),
      branchName,
    };
  }
  async status(input: AutoModeStatusInput) {
    if (input.projectPath) {
      const branchName = input.branchName ?? null;
      const state = await this.scheduler.getStatusForProject(
        this.contexts.canonicalProject(input.projectPath),
        branchName
      );
      return {
        success: true,
        isRunning: state.runningCount > 0,
        isAutoLoopRunning: state.isAutoLoopRunning,
        runningFeatures: state.runningFeatures,
        runningCount: state.runningCount,
        maxConcurrency: state.maxConcurrency,
        projectPath: input.projectPath,
        branchName,
      };
    }
    return {
      success: true,
      ...this.scheduler.getStatus(),
      activeAutoLoopProjects: this.scheduler.getActiveAutoLoopProjects(),
      activeAutoLoopWorktrees: this.scheduler.getActiveAutoLoopWorktrees(),
    };
  }
  async stopFeature(input: AutoModeStopFeatureInput) {
    return { success: true, stopped: await this.workflows.stopFeature(input.featureId) };
  }
  runFeature(input: AutoModeExecuteInput) {
    const project = this.contexts.canonicalProject(input.projectPath);
    this.contexts.launch(project, () =>
      this.workflows.executeFeature(project, input.featureId, input.useWorktrees ?? false, false)
    );
    return { success: true };
  }
  resumeFeature(input: AutoModeExecuteInput) {
    const project = this.contexts.canonicalProject(input.projectPath);
    this.contexts.launch(project, () =>
      this.workflows.resumeFeature(project, input.featureId, input.useWorktrees ?? false)
    );
    return { success: true };
  }
  followUpFeature(input: AutoModeFollowUpInput) {
    const project = this.contexts.canonicalProject(input.projectPath);
    this.contexts.launch(project, () =>
      this.workflows.followUpFeature(
        project,
        input.featureId,
        input.prompt,
        input.imagePaths,
        input.useWorktrees ?? false
      )
    );
    return { success: true };
  }
  analyzeProject(input: AutoModeProjectInput) {
    const project = this.contexts.canonicalProject(input.projectPath);
    if (this.contexts.isStopping())
      throw new UnavailableDomainError('Project analysis is unavailable.');
    this.analysis.launch(project);
    return { success: true, message: 'Project analysis started' };
  }
  async verifyFeature(input: AutoModeFeatureInput) {
    return {
      success: true,
      passes: await this.contexts.runAwaited(input.projectPath, () =>
        this.workflows.verifyFeature(input.projectPath, input.featureId)
      ),
    };
  }
  async contextExists(input: AutoModeFeatureInput) {
    return {
      success: true,
      exists: await this.workflows.contextExists(input.projectPath, input.featureId),
    };
  }
  async commitFeature(input: AutoModeCommitInput) {
    return {
      success: true,
      commitHash: await this.workflows.commitFeature(
        input.projectPath,
        input.featureId,
        input.worktreePath
      ),
    };
  }
  async mergeFeature(input: AutoModeMergeInput, common: boolean) {
    try {
      if (common) await this.workflows.mergeEnvironmentFeature(input.projectPath, input.featureId);
      else await this.workflows.mergeSSHFeature(input.projectPath, input.featureId);
      return { success: true };
    } catch (error) {
      throw new FeatureMergeError(
        error instanceof Error ? error.message : 'Remote feature merge failed.'
      );
    }
  }
  async resumeInterrupted(input: AutoModeProjectInput) {
    await this.recovery.resumeInterruptedFeatures(input.projectPath);
    return { success: true, message: 'Resume check completed' };
  }
  async reconcile(input: AutoModeProjectInput) {
    const reconciledCount = await this.recovery.reconcileFeatureStates(input.projectPath);
    return {
      success: true,
      reconciledCount,
      message:
        reconciledCount > 0
          ? `Reconciled ${reconciledCount} feature(s)`
          : 'No features needed reconciliation',
    };
  }
  async approvePlan(body: PlanApprovalDecisionInput) {
    const result = await this.workflows.resolvePlanApproval(
      body.projectPath,
      body.featureId,
      body.approved,
      body.editedPlan,
      body.feedback,
      body.approvalToken,
      body.planVersion,
      body.approvalRunId
    );
    if (!result.success) throw new ConflictDomainError(result.error ?? 'Plan approval conflict');
    return {
      success: true,
      approved: body.approved,
      message: body.approved
        ? 'Plan approved - implementation will continue'
        : 'Plan rejected - feature execution stopped',
    };
  }
  async pendingPlanApproval(body: PendingPlanApprovalInput) {
    return {
      success: true,
      approval: await this.workflows.getPendingPlanApproval(body.projectPath, body.featureId),
    };
  }
}
