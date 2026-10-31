import type { FeatureExecutionIntents } from '../feature-execution-intents.js';
import type { AgentCheckpointRepository } from '../../providers/openai-compatible/checkpoint.js';
import type { ObserveOperation } from '../../core/observability/operation-observer.js';
/**
 * Application-owned orchestration runtime. Public modules depend on narrow ports;
 * accepted per-project work belongs to the shared project context registry.
 */

import type { Feature } from '@automaker/types';
import fs from 'node:fs/promises';
import type { EventEmitter } from '../../lib/events.js';
import { GlobalAutoModeService } from './global-service.js';
import { AutoModeServiceFacade } from './facade.js';
import type { SettingsService } from '../settings-service.js';
import type { FeatureLoader } from '../feature-loader.js';
import type { ClaudeUsageService } from '../claude-usage-service.js';
import type { NotificationService } from '../notification-service.js';
import type { FacadeOptions, AutoModeStatus, RunningAgentInfo } from './types.js';
import type { ProviderRegistry } from '../../modules/providers/provider-registry.service.js';
import type { ToolPolicyService } from '../../modules/providers/tool-policy.service.js';
import type { PipelineService } from '../pipeline-service.js';
import { ProjectRunContextRegistry } from '../../modules/auto-mode/project-run-context.registry.js';
import type { FeatureRunCoordinator } from '../../modules/orchestration/feature-run-coordinator.service.js';

/**
 * Owns one scheduler, project context registry and ordered application shutdown.
 */
export class AutoModeRuntime {
  private readonly globalService: GlobalAutoModeService;
  private readonly facadeOptions: FacadeOptions;
  private readonly contexts: ProjectRunContextRegistry;
  private readonly executionIntents?: FeatureExecutionIntents;
  private disposal?: Promise<void>;

  constructor(
    events: EventEmitter,
    settingsService: SettingsService | null,
    featureLoader: FeatureLoader,
    claudeUsageService: ClaudeUsageService | null | undefined,
    notificationService: NotificationService | null | undefined,
    providerRegistry: ProviderRegistry,
    toolPolicy: ToolPolicyService | undefined,
    pipeline: PipelineService,
    filesystem: import('../execution-filesystem.js').ExecutionFilesystem,
    runtime?: {
      contexts: ProjectRunContextRegistry;
      executionIntents?: FeatureExecutionIntents;
      observeOperation?: ObserveOperation;
      checkpointRepository?: AgentCheckpointRepository;
      coordinator?: FeatureRunCoordinator;
      hostEnvironment?: Readonly<NodeJS.ProcessEnv>;
      validateWorkingDirectory?: (cwd: string) => void;
    }
  ) {
    this.executionIntents = runtime?.executionIntents;
    this.contexts = runtime?.contexts ?? new ProjectRunContextRegistry();
    this.globalService = new GlobalAutoModeService(
      events,
      settingsService,
      featureLoader,
      notificationService,
      pipeline,
      runtime?.coordinator,
      runtime?.executionIntents,
      runtime?.hostEnvironment
    );
    const sharedServices = this.globalService.getSharedServices();

    this.facadeOptions = {
      events,
      settingsService,
      featureLoader,
      sharedServices,
      claudeUsageService: claudeUsageService ?? null,
      notificationService: notificationService ?? null,
      providerRegistry,
      toolPolicy,
      pipeline,
      validateWorkingDirectory: runtime?.validateWorkingDirectory,
      hostEnvironment: Object.freeze({ ...(runtime?.hostEnvironment ?? process.env) }),
      filesystem,
      checkpointRepository: runtime?.checkpointRepository,
      observeOperation: runtime?.observeOperation,
    };
  }

  /**
   * Get the global service for direct access
   */
  onModuleDestroy(): Promise<void> {
    return (this.disposal ??= (async () => {
      const results = await Promise.allSettled([
        this.contexts.onModuleDestroy(),
        this.globalService.onModuleDestroy(),
      ]);
      let storageError: unknown;
      try {
        await this.executionIntents?.close();
      } catch (error) {
        storageError = error;
      }
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (storageError) throw storageError;
    })());
  }

  getGlobalService(): GlobalAutoModeService {
    return this.globalService;
  }

  /**
   * Get or create a facade for a specific project.
   * Facades are cached by project path so that auto loop state
   * (stored in the facade's AutoLoopCoordinator) persists across API calls.
   */
  createFacade(projectPath: string): AutoModeServiceFacade {
    return this.contexts.getOrCreate(projectPath, (canonical) =>
      AutoModeServiceFacade.create(canonical, this.facadeOptions)
    );
  }

  // ===========================================================================
  // GLOBAL OPERATIONS (delegated to GlobalAutoModeService)
  // ===========================================================================

  getStatus(): AutoModeStatus {
    return this.globalService.getStatus();
  }
  async isProjectRunning(projectPath: string): Promise<boolean> {
    const canonical = await fs.realpath(projectPath);
    for (const run of this.globalService.getSharedServices().concurrencyManager.getAllRunning()) {
      if ((await fs.realpath(run.projectPath)) === canonical) return true;
    }
    return false;
  }

  getActiveAutoLoopProjects(): string[] {
    return this.globalService.getActiveAutoLoopProjects();
  }

  getActiveAutoLoopWorktrees(): Array<{ projectPath: string; branchName: string | null }> {
    return this.globalService.getActiveAutoLoopWorktrees();
  }

  async getRunningAgents(): Promise<RunningAgentInfo[]> {
    return this.globalService.getRunningAgents();
  }

  async markAllRunningFeaturesInterrupted(reason?: string): Promise<void> {
    return this.globalService.markAllRunningFeaturesInterrupted(reason);
  }

  /** Called after interruption has been persisted by the application lifecycle. */
  closeAdmission(): void {
    this.contexts.stopAdmission();
    this.globalService.getSharedServices().worktreeResolver.stopAdmission();
    this.globalService.getSharedServices().concurrencyManager.stopAdmission();
  }

  interruptForShutdown(): void {
    this.closeAdmission();
    this.contexts.interruptForShutdown();
    const shared = this.globalService.getSharedServices();
    shared.concurrencyManager.stopAdmission();
    shared.autoLoopCoordinator.interruptForShutdown();
    for (const run of shared.concurrencyManager.getAllRunning()) {
      run.abortController.abort();
    }
  }

  async reconcileFeatureStates(projectPath: string): Promise<number> {
    return this.globalService.reconcileFeatureStates(projectPath);
  }

  // ===========================================================================
  // PER-PROJECT OPERATIONS (delegated to facades)
  // ===========================================================================

  async getStatusForProject(
    projectPath: string,
    branchName: string | null = null
  ): Promise<{
    isAutoLoopRunning: boolean;
    runningFeatures: string[];
    runningCount: number;
    maxConcurrency: number;
    branchName: string | null;
  }> {
    const facade = this.createFacade(projectPath);
    return facade.getStatusForProject(branchName);
  }

  isAutoLoopRunningForProject(projectPath: string, branchName: string | null = null): boolean {
    const facade = this.createFacade(projectPath);
    return facade.isAutoLoopRunning(branchName);
  }

  async startAutoLoopForProject(
    projectPath: string,
    branchName: string | null = null,
    maxConcurrency?: number,
    outputLocale?: import('@automaker/types').OutputLocale
  ): Promise<number> {
    const facade = this.createFacade(projectPath);
    return facade.startAutoLoop(branchName, maxConcurrency, outputLocale);
  }

  async stopAutoLoopForProject(
    projectPath: string,
    branchName: string | null = null
  ): Promise<number> {
    const facade = this.createFacade(projectPath);
    return facade.stopAutoLoop(branchName);
  }

  async executeFeature(
    projectPath: string,
    featureId: string,
    useWorktrees = false,
    isAutoMode = false,
    providedWorktreePath?: string,
    options?: {
      continuationPrompt?: string;
      _calledInternally?: boolean;
      outputLocale?: import('@automaker/types').OutputLocale;
    }
  ): Promise<void> {
    const facade = this.createFacade(projectPath);
    return facade.executeFeature(
      featureId,
      useWorktrees,
      isAutoMode,
      providedWorktreePath,
      options
    );
  }

  async stopFeature(featureId: string): Promise<boolean> {
    // Stop feature is tricky - we need to find which project the feature is running in
    // The concurrency manager tracks this
    const runningAgents = await this.getRunningAgents();
    const agent = runningAgents.find((a) => a.featureId === featureId);
    if (agent) {
      const facade = this.createFacade(agent.projectPath);
      return facade.stopFeature(featureId);
    }
    return false;
  }

  async resumeFeature(
    projectPath: string,
    featureId: string,
    useWorktrees = false,
    outputLocale?: import('@automaker/types').OutputLocale
  ): Promise<void> {
    const facade = this.createFacade(projectPath);
    return facade.resumeFeature(featureId, useWorktrees, false, undefined, outputLocale);
  }

  async followUpFeature(
    projectPath: string,
    featureId: string,
    prompt: string,
    imagePaths?: string[],
    useWorktrees = true,
    outputLocale?: import('@automaker/types').OutputLocale
  ): Promise<void> {
    const facade = this.createFacade(projectPath);
    return facade.followUpFeature(featureId, prompt, imagePaths, useWorktrees, outputLocale);
  }

  async verifyFeature(projectPath: string, featureId: string): Promise<boolean> {
    const facade = this.createFacade(projectPath);
    return facade.verifyFeature(featureId);
  }

  async commitFeature(
    projectPath: string,
    featureId: string,
    providedWorktreePath?: string
  ): Promise<string | null> {
    const facade = this.createFacade(projectPath);
    return facade.commitFeature(featureId, providedWorktreePath);
  }

  async contextExists(projectPath: string, featureId: string): Promise<boolean> {
    const facade = this.createFacade(projectPath);
    return facade.contextExists(featureId);
  }

  async mergeSSHFeature(projectPath: string, featureId: string): Promise<void> {
    return this.createFacade(projectPath).mergeSSHFeature(featureId);
  }

  async mergeEnvironmentFeature(projectPath: string, featureId: string): Promise<void> {
    return this.createFacade(projectPath).mergeEnvironmentFeature(featureId);
  }

  async resolvePlanApproval(
    projectPath: string,
    featureId: string,
    approved: boolean,
    editedPlan?: string,
    feedback?: string,
    approvalToken?: string,
    planVersion?: number,
    approvalRunId?: string
  ): Promise<{ success: boolean; error?: string }> {
    const facade = this.createFacade(projectPath);
    return facade.resolvePlanApproval(
      featureId,
      approved,
      editedPlan,
      feedback,
      approvalToken,
      planVersion,
      approvalRunId
    );
  }

  getPendingPlanApproval(projectPath: string, featureId: string) {
    return this.createFacade(projectPath).getPendingPlanApproval(featureId);
  }

  async resumeInterruptedFeatures(
    projectPath: string,
    outputLocale?: import('@automaker/types').OutputLocale
  ): Promise<void> {
    if (this.contexts.isStopping()) return;
    const facade = this.createFacade(projectPath);
    return facade.resumeInterruptedFeatures(outputLocale);
  }

  async checkWorktreeCapacity(
    projectPath: string,
    featureId: string
  ): Promise<{
    hasCapacity: boolean;
    currentAgents: number;
    maxAgents: number;
    branchName: string | null;
  }> {
    const facade = this.createFacade(projectPath);
    return facade.checkWorktreeCapacity(featureId);
  }

  async detectOrphanedFeatures(
    projectPath: string,
    preloadedFeatures?: Feature[]
  ): Promise<Array<{ feature: Feature; missingBranch: string }>> {
    const facade = this.createFacade(projectPath);
    return facade.detectOrphanedFeatures(preloadedFeatures);
  }
}
