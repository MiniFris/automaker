/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface WorktreeBranchesInput {
  [key: string]: unknown;
  worktreePath: string;
  includeRemote: boolean;
}

export interface WorktreeBranchCommitLogInput {
  [key: string]: unknown;
  worktreePath: string;
  limit: number;
  branchName?: string | undefined;
}

export interface WorktreeCommitLogInput {
  [key: string]: unknown;
  worktreePath: string;
  limit: number;
}

export interface WorktreeCommitInput {
  [key: string]: unknown;
  worktreePath: string;
  message: string;
  files?: string[] | undefined;
  environmentTargetId?: string | undefined;
}

export interface WorktreeCheckoutBranchInput {
  [key: string]: unknown;
  worktreePath: string;
  branchName: string;
  environmentTargetId?: string | undefined;
  baseBranch?: string | undefined;
  stashChanges?: boolean | undefined;
  includeUntracked?: boolean | undefined;
}

export interface WorktreeCherryPickInput {
  [key: string]: unknown;
  worktreePath: string;
  commitHashes: string[];
  environmentTargetId?: string | undefined;
  options?: { noCommit?: boolean | undefined } | undefined;
}

export interface WorktreeMergeInput {
  [key: string]: unknown;
  projectPath: string;
  branchName: string;
  worktreePath: string;
  targetBranch: string;
  options?:
    | {
        squash?: boolean | undefined;
        message?: string | undefined;
        deleteWorktreeAndBranch?: boolean | undefined;
        remote?: string | undefined;
      }
    | undefined;
  environmentTargetId?: string | undefined;
}

export interface WorktreeCreateInput {
  [key: string]: unknown;
  projectPath: string;
  branchName: string;
  baseBranch?: string | undefined;
  environmentTargetId?: string | undefined;
}

export interface WorktreeDeleteInput {
  [key: string]: unknown;
  projectPath: string;
  worktreePath: string;
  deleteBranch?: boolean | undefined;
  environmentTargetId?: string | undefined;
}

export interface WorktreeInitGitInput {
  [key: string]: unknown;
  projectPath: string;
}

export interface WorktreeInitScriptDeleteInput {
  [key: string]: unknown;
  projectPath: string;
  environmentTargetId?: string | undefined;
}

export interface WorktreeInitScriptQueryInput {
  [key: string]: unknown;
  projectPath: string;
}

export interface WorktreeInitScriptWriteInput {
  [key: string]: unknown;
  projectPath: string;
  content: string;
  environmentTargetId?: string | undefined;
}

export interface WorktreeRunInitScriptInput {
  [key: string]: unknown;
  projectPath: string;
  worktreePath: string;
  branch: string;
  environmentTargetId?: string | undefined;
}

export interface WorktreePrInfoInput {
  [key: string]: unknown;
  worktreePath: string;
  branchName: string;
}

export interface WorktreeUpdatePrNumberInput {
  [key: string]: unknown;
  worktreePath: string;
  prNumber: number;
  environmentTargetId?: string | undefined;
  projectPath?: string | undefined;
}

export interface WorktreeCreatePrInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
  projectPath?: string | undefined;
  commitMessage?: string | undefined;
  prTitle?: string | undefined;
  prBody?: string | undefined;
  baseBranch?: string | undefined;
  draft?: boolean | undefined;
  remote?: string | undefined;
  targetRemote?: string | undefined;
}

export interface WorktreeDiscardInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
  files?: string[] | undefined;
}

export interface WorktreeFeatureInput {
  [key: string]: unknown;
  projectPath: string;
  featureId: string;
  useWorktrees?: boolean | undefined;
}

export interface WorktreeFileInput {
  [key: string]: unknown;
  projectPath: string;
  featureId: string;
  filePath: string;
  useWorktrees?: boolean | undefined;
}

export interface WorktreePathInput {
  [key: string]: unknown;
  worktreePath: string;
}

export interface WorktreeProjectInput {
  [key: string]: unknown;
  projectPath: string;
  includeDetails?: boolean | undefined;
  forceRefreshGitHub?: boolean | undefined;
}

export interface WorktreePullInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
  remote?: string | undefined;
  remoteBranch?: string | undefined;
  stashIfNeeded?: boolean | undefined;
}

export interface WorktreePushInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
  remote?: string | undefined;
  force?: boolean | undefined;
  autoResolve?: boolean | undefined;
}

export interface WorktreeRebaseInput {
  [key: string]: unknown;
  worktreePath: string;
  ontoBranch: string;
  environmentTargetId?: string | undefined;
  remote?: string | undefined;
}

export interface WorktreeMutationInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
}

export interface WorktreeRemoteAddInput {
  [key: string]: unknown;
  worktreePath: string;
  remoteName: string;
  remoteUrl: string;
  environmentTargetId?: string | undefined;
}

export interface WorktreeStashApplyInput {
  [key: string]: unknown;
  worktreePath: string;
  stashIndex: number;
  environmentTargetId?: string | undefined;
  pop?: boolean | undefined;
}

export interface WorktreeStashDropInput {
  [key: string]: unknown;
  worktreePath: string;
  stashIndex: number;
  environmentTargetId?: string | undefined;
}

export interface WorktreeStashPushInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
  message?: string | undefined;
  files?: string[] | undefined;
}

export interface WorktreeStageFilesInput {
  [key: string]: unknown;
  worktreePath: string;
  files: string[];
  operation: 'stage' | 'unstage';
  environmentTargetId?: string | undefined;
}

export interface WorktreeTrackingInput {
  [key: string]: unknown;
  worktreePath: string;
  remote: string;
  environmentTargetId?: string | undefined;
  branch?: string | undefined;
}

export interface WorktreeSwitchBranchInput {
  [key: string]: unknown;
  worktreePath: string;
  branchName: string;
  environmentTargetId?: string | undefined;
}

export interface WorktreeSyncInput {
  [key: string]: unknown;
  worktreePath: string;
  environmentTargetId?: string | undefined;
  remote?: string | undefined;
}
