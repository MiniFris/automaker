import type { OutputLocale } from '@automaker/types';

/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface AutoModeBranchInput {
  projectPath: string;
  branchName?: string | null | undefined;
}

export interface AutoModeCommitInput {
  projectPath: string;
  featureId: string;
  worktreePath?: string | undefined;
}

export interface AutoModeExecuteInput {
  outputLocale?: OutputLocale;
  projectPath: string;
  featureId: string;
  useWorktrees?: boolean | undefined;
}

export interface AutoModeFeatureInput {
  projectPath: string;
  featureId: string;
}

export interface AutoModeFollowUpInput {
  outputLocale?: OutputLocale;
  projectPath: string;
  featureId: string;
  prompt: string;
  useWorktrees?: boolean | undefined;
  imagePaths?: string[] | undefined;
}

export interface AutoModeMergeInput {
  projectPath: string;
  featureId: string;
}

export interface AutoModeProjectInput {
  outputLocale?: OutputLocale;
  projectPath: string;
}

export interface AutoModeStartInput {
  outputLocale?: OutputLocale;
  projectPath: string;
  branchName?: string | null | undefined;
  maxConcurrency?: number | undefined;
}

export interface AutoModeStatusInput {
  projectPath?: string | undefined;
  branchName?: string | null | undefined;
}

export interface AutoModeStopFeatureInput {
  featureId: string;
}

export interface PendingPlanApprovalInput {
  projectPath: string;
  featureId: string;
}

export interface PlanApprovalDecisionInput {
  projectPath: string;
  featureId: string;
  approved: boolean;
  approvalToken: string;
  approvalRunId: string;
  planVersion: number;
  editedPlan?: string | undefined;
  feedback?: string | undefined;
}
