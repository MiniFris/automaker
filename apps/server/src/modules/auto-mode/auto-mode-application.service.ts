import { ProjectAnalysisService } from './project-analysis.service.js';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import { ProjectRunContextRegistry } from './project-run-context.registry.js';
import type {
  AutoModeBranchRequest,
  AutoModeCommitRequest,
  AutoModeExecuteRequest,
  AutoModeFeatureRequest,
  AutoModeFollowUpRequest,
  AutoModeMergeRequest,
  AutoModeProjectRequest,
  AutoModeStartRequest,
  AutoModeStatusRequest,
  AutoModeStopFeatureRequest,
} from './auto-mode.schemas.js';
import type { PendingPlanApprovalRequest, PlanApprovalDecisionRequest } from '@automaker/contracts';
import { ConflictDomainError } from '../../core/errors/domain-errors.js';

@Injectable()
export class AutoModeApplicationService {
  constructor(
    @Inject(AutoModeServiceCompat) private readonly autoMode: AutoModeServiceCompat,
    @Inject(ProjectRunContextRegistry) private readonly contexts: ProjectRunContextRegistry,
    @Inject(ProjectAnalysisService) private readonly analysis: ProjectAnalysisService
  ) {}

  async start(input: AutoModeStartRequest) {
    const project = this.contexts.canonicalProject(input.projectPath),
      branchName = input.branchName ?? null;
    const description = branchName ? `worktree ${branchName}` : 'main worktree';
    if (this.autoMode.isAutoLoopRunningForProject(project, branchName))
      return {
        success: true,
        message: `Auto mode is already running for ${description}`,
        alreadyRunning: true,
        branchName,
      };
    const concurrency = await this.autoMode.startAutoLoopForProject(
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
  async stop(input: AutoModeBranchRequest) {
    const project = this.contexts.canonicalProject(input.projectPath),
      branchName = input.branchName ?? null;
    const description = branchName ? `worktree ${branchName}` : 'main worktree';
    if (!this.autoMode.isAutoLoopRunningForProject(project, branchName))
      return {
        success: true,
        message: `Auto mode is not running for ${description}`,
        wasRunning: false,
        branchName,
      };
    return {
      success: true,
      message: 'Auto mode stopped',
      runningFeaturesCount: await this.autoMode.stopAutoLoopForProject(project, branchName),
      branchName,
    };
  }
  async status(input: AutoModeStatusRequest) {
    if (input.projectPath) {
      const branchName = input.branchName ?? null;
      const state = await this.autoMode.getStatusForProject(
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
      ...this.autoMode.getStatus(),
      activeAutoLoopProjects: this.autoMode.getActiveAutoLoopProjects(),
      activeAutoLoopWorktrees: this.autoMode.getActiveAutoLoopWorktrees(),
    };
  }
  async stopFeature(input: AutoModeStopFeatureRequest) {
    return { success: true, stopped: await this.autoMode.stopFeature(input.featureId) };
  }
  runFeature(input: AutoModeExecuteRequest) {
    const project = this.contexts.canonicalProject(input.projectPath);
    this.contexts.launch(project, () =>
      this.autoMode.executeFeature(project, input.featureId, input.useWorktrees ?? false, false)
    );
    return { success: true };
  }
  resumeFeature(input: AutoModeExecuteRequest) {
    const project = this.contexts.canonicalProject(input.projectPath);
    this.contexts.launch(project, () =>
      this.autoMode.resumeFeature(project, input.featureId, input.useWorktrees ?? false)
    );
    return { success: true };
  }
  followUpFeature(input: AutoModeFollowUpRequest) {
    const project = this.contexts.canonicalProject(input.projectPath);
    this.contexts.launch(project, () =>
      this.autoMode.followUpFeature(
        project,
        input.featureId,
        input.prompt,
        input.imagePaths,
        input.useWorktrees ?? false
      )
    );
    return { success: true };
  }
  analyzeProject(input: AutoModeProjectRequest) {
    const project = this.contexts.canonicalProject(input.projectPath);
    if (this.contexts.isStopping())
      throw new UnavailableDomainError('Project analysis is unavailable.');
    this.analysis.launch(project);
    return { success: true, message: 'Project analysis started' };
  }
  async verifyFeature(input: AutoModeFeatureRequest) {
    return {
      success: true,
      passes: await this.contexts.runAwaited(input.projectPath, () =>
        this.autoMode.verifyFeature(input.projectPath, input.featureId)
      ),
    };
  }
  async contextExists(input: AutoModeFeatureRequest) {
    return {
      success: true,
      exists: await this.autoMode.contextExists(input.projectPath, input.featureId),
    };
  }
  async commitFeature(input: AutoModeCommitRequest) {
    return {
      success: true,
      commitHash: await this.autoMode.commitFeature(
        input.projectPath,
        input.featureId,
        input.worktreePath
      ),
    };
  }
  async mergeFeature(input: AutoModeMergeRequest, common: boolean) {
    try {
      if (common) await this.autoMode.mergeEnvironmentFeature(input.projectPath, input.featureId);
      else await this.autoMode.mergeSSHFeature(input.projectPath, input.featureId);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Remote feature merge failed.',
        },
        400
      );
    }
  }
  async resumeInterrupted(input: AutoModeProjectRequest) {
    await this.autoMode.resumeInterruptedFeatures(input.projectPath);
    return { success: true, message: 'Resume check completed' };
  }
  async reconcile(input: AutoModeProjectRequest) {
    const reconciledCount = await this.autoMode.reconcileFeatureStates(input.projectPath);
    return {
      success: true,
      reconciledCount,
      message:
        reconciledCount > 0
          ? `Reconciled ${reconciledCount} feature(s)`
          : 'No features needed reconciliation',
    };
  }
  async approvePlan(body: PlanApprovalDecisionRequest) {
    const result = await this.autoMode.resolvePlanApproval(
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
  async pendingPlanApproval(body: PendingPlanApprovalRequest) {
    return {
      success: true,
      approval: await this.autoMode.getPendingPlanApproval(body.projectPath, body.featureId),
    };
  }
}
