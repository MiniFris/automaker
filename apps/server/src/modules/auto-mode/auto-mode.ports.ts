import type { Feature } from '@automaker/types';
import type {
  AutoModeStatus,
  ProjectAutoModeStatus,
  RunningAgentInfo,
} from '../../services/auto-mode/types.js';

/** Public read boundary shared by project, Git/worktree and running-agent queries. */
export const FEATURE_RUN_READ_MODEL = Symbol('FEATURE_RUN_READ_MODEL');
export interface FeatureRunReadModel {
  isProjectRunning(projectPath: string): Promise<boolean>;
  getRunningAgents(): Promise<RunningAgentInfo[]>;
  getStatusForProject(
    projectPath: string,
    branchName?: string | null
  ): Promise<ProjectAutoModeStatus>;
}
export const FEATURE_ORPHAN_QUERY = Symbol('FEATURE_ORPHAN_QUERY');
export interface FeatureOrphanQuery {
  detectOrphanedFeatures(
    projectPath: string,
    preloadedFeatures?: Feature[]
  ): Promise<Array<{ feature: Feature; missingBranch: string }>>;
}
/** Startup/shutdown admission belongs to the existing owner, not a second registry. */
export const AUTO_MODE_LIFECYCLE = Symbol('AUTO_MODE_LIFECYCLE');
export interface AutoModeLifecycle {
  reconcileFeatureStates(projectPath: string): Promise<number>;
  resumeInterruptedFeatures(projectPath: string): Promise<void>;
  closeAdmission(): void;
  markAllRunningFeaturesInterrupted(reason?: string): Promise<void>;
  interruptForShutdown(): void;
}

// These two ports are deliberately not exported by AutoModeModule to other modules.
export const AUTO_MODE_SCHEDULER = Symbol('AUTO_MODE_SCHEDULER');
export interface AutoModeScheduler {
  isAutoLoopRunningForProject(projectPath: string, branchName?: string | null): boolean;
  startAutoLoopForProject(
    projectPath: string,
    branchName?: string | null,
    maxConcurrency?: number
  ): Promise<number>;
  stopAutoLoopForProject(projectPath: string, branchName?: string | null): Promise<number>;
  getStatus(): AutoModeStatus;
  getStatusForProject(
    projectPath: string,
    branchName?: string | null
  ): Promise<ProjectAutoModeStatus>;
  getActiveAutoLoopProjects(): string[];
  getActiveAutoLoopWorktrees(): Array<{ projectPath: string; branchName: string | null }>;
}
export const FEATURE_WORKFLOW = Symbol('FEATURE_WORKFLOW');
export interface FeatureWorkflow {
  executeFeature(
    projectPath: string,
    featureId: string,
    useWorktrees?: boolean,
    isAutoMode?: boolean
  ): Promise<void>;
  stopFeature(featureId: string): Promise<boolean>;
  resumeFeature(projectPath: string, featureId: string, useWorktrees?: boolean): Promise<void>;
  followUpFeature(
    projectPath: string,
    featureId: string,
    prompt: string,
    imagePaths?: string[],
    useWorktrees?: boolean
  ): Promise<void>;
  verifyFeature(projectPath: string, featureId: string): Promise<boolean>;
  contextExists(projectPath: string, featureId: string): Promise<boolean>;
  commitFeature(
    projectPath: string,
    featureId: string,
    providedWorktreePath?: string
  ): Promise<string | null>;
  mergeEnvironmentFeature(projectPath: string, featureId: string): Promise<void>;
  mergeSSHFeature(projectPath: string, featureId: string): Promise<void>;
  resolvePlanApproval(
    projectPath: string,
    featureId: string,
    approved: boolean,
    editedPlan?: string,
    feedback?: string,
    approvalToken?: string,
    planVersion?: number,
    approvalRunId?: string
  ): Promise<{ success: boolean; error?: string }>;
  getPendingPlanApproval(
    projectPath: string,
    featureId: string
  ): Promise<{
    approvalToken: string;
    approvalRunId: string;
    planVersion: number;
    planContent: string;
  } | null>;
}
