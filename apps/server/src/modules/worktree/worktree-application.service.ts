import type {
  WorktreeBranchesInput,
  WorktreeBranchCommitLogInput,
  WorktreeCommitLogInput,
  WorktreeCommitInput,
  WorktreeCheckoutBranchInput,
  WorktreeCherryPickInput,
  WorktreeMergeInput,
  WorktreeCreateInput,
  WorktreeDeleteInput,
  WorktreeInitGitInput,
  WorktreeInitScriptDeleteInput,
  WorktreeInitScriptQueryInput,
  WorktreeInitScriptWriteInput,
  WorktreeRunInitScriptInput,
  WorktreePrInfoInput,
  WorktreeUpdatePrNumberInput,
  WorktreeCreatePrInput,
  WorktreeDiscardInput,
  WorktreeFeatureInput,
  WorktreeFileInput,
  WorktreePathInput,
  WorktreeProjectInput,
  WorktreePullInput,
  WorktreePushInput,
  WorktreeRebaseInput,
  WorktreeMutationInput,
  WorktreeRemoteAddInput,
  WorktreeStashApplyInput,
  WorktreeStashDropInput,
  WorktreeStashPushInput,
  WorktreeStageFilesInput,
  WorktreeTrackingInput,
  WorktreeSwitchBranchInput,
  WorktreeSyncInput,
} from './application.inputs.js';

import { getAutomakerDir } from '@automaker/platform';
import type { EventEmitter } from '../../lib/events.js';

import { type FeatureRunReadModel } from '../auto-mode/auto-mode.ports.js';
import { FeatureLoader } from '../../services/feature-loader.js';
import { SettingsService } from '../../services/settings-service.js';
import {
  ProjectGitService,
  gitWriteActions,
} from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { sshSerialized } from '../../services/execution-environment/ssh-state.js';

export class WorktreeApplicationService {
  constructor(
    private readonly git: ProjectGitService,
    private readonly events: EventEmitter,

    private readonly autoMode: Pick<FeatureRunReadModel, 'isProjectRunning'>,
    private readonly settings: SettingsService,
    private readonly features: FeatureLoader
  ) {}

  async environment(input: WorktreeProjectInput) {
    const target = await this.git.resolveOrLocal(input.projectPath);
    return { success: true as const, executionEnvironment: target.environment };
  }

  list(input: WorktreeProjectInput, signal: AbortSignal) {
    return this.runPath('list', input.projectPath, input, signal);
  }

  info(input: WorktreeFeatureInput, signal: AbortSignal) {
    return this.runFeature('info', input, signal);
  }

  status(input: WorktreeFeatureInput, signal: AbortSignal) {
    return this.runFeature('status', input, signal);
  }

  diffs(input: WorktreeFeatureInput, signal: AbortSignal) {
    return this.runFeature('diffs', input, signal);
  }

  async fileDiff(input: WorktreeFileInput, signal: AbortSignal) {
    if (input.useWorktrees === false) {
      const managed = await this.git.resolve(input.projectPath, input.featureId);
      if (managed) return this.git.run(managed, 'file-diff', input, signal);
      return Promise.resolve({ success: true as const, diff: '', filePath: input.filePath });
    }
    return this.runFeature('file-diff', input, signal);
  }

  checkChanges(input: WorktreePathInput, signal: AbortSignal) {
    return this.runPath('check-changes', input.worktreePath, input, signal);
  }

  listBranches(input: WorktreeBranchesInput, signal: AbortSignal) {
    return this.runPath('list-branches', input.worktreePath, input, signal);
  }

  listRemotes(input: WorktreePathInput, signal: AbortSignal) {
    return this.runPath('list-remotes', input.worktreePath, input, signal);
  }

  stageFiles(input: WorktreeStageFilesInput, signal: AbortSignal) {
    return this.runPath('stage-files', input.worktreePath, input, signal);
  }

  commit(input: WorktreeCommitInput, signal: AbortSignal) {
    return this.runPath('commit', input.worktreePath, input, signal);
  }

  abortOperation(input: WorktreeMutationInput, signal: AbortSignal) {
    return this.runPath('abort-operation', input.worktreePath, input, signal);
  }

  continueOperation(input: WorktreeMutationInput, signal: AbortSignal) {
    return this.runPath('continue-operation', input.worktreePath, input, signal);
  }

  addRemote(input: WorktreeRemoteAddInput, signal: AbortSignal) {
    return this.runPath('add-remote', input.worktreePath, input, signal);
  }

  setTracking(input: WorktreeTrackingInput, signal: AbortSignal) {
    return this.runPath('set-tracking', input.worktreePath, input, signal);
  }

  stashList(input: WorktreePathInput, signal: AbortSignal) {
    return this.runPath('stash-list', input.worktreePath, input, signal);
  }

  stashPush(input: WorktreeStashPushInput, signal: AbortSignal) {
    return this.runPath('stash-push', input.worktreePath, input, signal);
  }

  stashApply(input: WorktreeStashApplyInput, signal: AbortSignal) {
    return this.runPath('stash-apply', input.worktreePath, input, signal);
  }

  stashDrop(input: WorktreeStashDropInput, signal: AbortSignal) {
    return this.runPath('stash-drop', input.worktreePath, input, signal);
  }

  checkoutBranch(input: WorktreeCheckoutBranchInput, signal: AbortSignal) {
    return this.runPath('checkout-branch', input.worktreePath, input, signal);
  }

  switchBranch(input: WorktreeSwitchBranchInput, signal: AbortSignal) {
    return this.runPath('switch-branch', input.worktreePath, input, signal);
  }

  discardChanges(input: WorktreeDiscardInput, signal: AbortSignal) {
    return this.runPath('discard-changes', input.worktreePath, input, signal);
  }

  pull(input: WorktreePullInput, signal: AbortSignal) {
    return this.runPath('pull', input.worktreePath, input, signal);
  }

  push(input: WorktreePushInput, signal: AbortSignal) {
    return this.runPath('push', input.worktreePath, input, signal);
  }

  sync(input: WorktreeSyncInput, signal: AbortSignal) {
    return this.runPath('sync', input.worktreePath, input, signal);
  }

  rebase(input: WorktreeRebaseInput, signal: AbortSignal) {
    return this.runPath('rebase', input.worktreePath, input, signal);
  }

  async cherryPick(input: WorktreeCherryPickInput, signal: AbortSignal) {
    this.events.emit('cherry-pick:started', {
      worktreePath: input.worktreePath,
      commitHashes: input.commitHashes,
    });
    try {
      const response = await this.runPath('cherry-pick', input.worktreePath, input, signal);
      const result = response.result as {
        cherryPicked?: boolean;
        commitHashes?: string[];
        branch?: string;
        hasConflicts?: boolean;
        aborted?: boolean;
      };
      this.events.emit(result.hasConflicts ? 'cherry-pick:conflict' : 'cherry-pick:success', {
        worktreePath: input.worktreePath,
        commitHashes: input.commitHashes,
        branch: result.branch,
        aborted: result.aborted,
      });
      return response;
    } catch (error) {
      this.events.emit('cherry-pick:failure', { error: this.message(error) });
      throw error;
    }
  }

  async merge(input: WorktreeMergeInput, signal: AbortSignal) {
    this.events.emit('merge:start', {
      branchName: input.branchName,
      targetBranch: input.targetBranch,
      worktreePath: input.worktreePath,
    });
    try {
      const response = await this.runPath('merge', input.projectPath, input, signal);
      const result = response.result as {
        hasConflicts?: boolean;
        conflictFiles?: string[];
        mergedBranch?: string;
        targetBranch?: string;
        deleted?: unknown;
      };
      this.events.emit(result.hasConflicts ? 'merge:conflict' : 'merge:success', {
        branchName: input.branchName,
        targetBranch: input.targetBranch,
        conflictFiles: result.conflictFiles,
        mergedBranch: result.mergedBranch,
        deleted: result.deleted,
      });
      return { ...response, ...result };
    } catch (error) {
      this.events.emit('merge:error', {
        branchName: input.branchName,
        targetBranch: input.targetBranch,
        error: this.message(error),
      });
      throw error;
    }
  }

  async create(input: WorktreeCreateInput, signal: AbortSignal) {
    const projectSettings = await this.settings.getProjectSettings(input.projectPath);
    const copyFiles = Array.isArray(projectSettings.worktreeCopyFiles)
      ? projectSettings.worktreeCopyFiles
      : [];
    const response = await this.runPath(
      'create',
      input.projectPath,
      { ...input, copyFiles },
      signal
    );
    const copied = (response.copyResults ?? []) as Array<{
      path: string;
      type?: string;
      status: 'copied' | 'skipped' | 'failed';
      reason?: string;
      error?: string;
    }>;
    for (const entry of copied)
      this.events.emit(`worktree:copy-files:${entry.status}`, {
        path: entry.path,
        type: entry.type,
        reason: entry.reason,
        error: entry.error,
      });
    const worktree = response.worktree as { path: string; branch: string; isNew: boolean };
    if (worktree.isNew)
      this.startInitScript({
        projectPath: input.projectPath,
        worktreePath: worktree.path,
        branch: worktree.branch,
      });
    return response;
  }

  async delete(input: WorktreeDeleteInput, signal: AbortSignal) {
    const response = await this.runPath('delete', input.projectPath, input, signal);
    const result = response.deleted as {
      worktreePath: string;
      branchName?: string;
      branchDeleted: boolean;
      featuresMovedToMain?: number;
    };
    let featuresMovedToMain = 0;
    if (result.branchName) {
      for (const feature of (await this.features.getAll(input.projectPath)).filter(
        (item) => item.branchName === result.branchName
      )) {
        await this.features.update(input.projectPath, feature.id, { branchName: null });
        featuresMovedToMain++;
        this.events.emit('feature:migrated', {
          featureId: feature.id,
          status: 'migrated',
          fromBranch: result.branchName,
          toWorktreeId: null,
          projectPath: input.projectPath,
        });
      }
    }
    result.featuresMovedToMain = featuresMovedToMain;
    this.events.emit('worktree:deleted', {
      worktreePath: input.worktreePath,
      projectPath: input.projectPath,
      branchName: result.branchName ?? null,
      branchDeleted: result.branchDeleted,
    });
    return response;
  }

  initGit(input: WorktreeInitGitInput, signal: AbortSignal) {
    return this.runPath('init-git', input.projectPath, input, signal);
  }

  getInitScript(input: WorktreeInitScriptQueryInput, signal: AbortSignal) {
    return this.runPath('init-script-get', input.projectPath, input, signal);
  }

  putInitScript(input: WorktreeInitScriptWriteInput, signal: AbortSignal) {
    return this.runPath('init-script-put', input.projectPath, input, signal);
  }

  deleteInitScript(input: WorktreeInitScriptDeleteInput, signal: AbortSignal) {
    return this.runPath('init-script-delete', input.projectPath, input, signal);
  }

  async runInitScript(input: WorktreeRunInitScriptInput) {
    const target = await this.git.resolveOrLocal(input.worktreePath);
    const legacyLocal =
      target.runtime.type === 'local' && !target.binding && !input.environmentTargetId;
    if (!legacyLocal && input.environmentTargetId !== target.environment.targetId)
      throw new ExecutionEnvironmentError(
        'GIT_TARGET_CHANGED',
        'Inspect this workspace again before running its init script. No command was dispatched.'
      );
    if (await this.autoMode.isProjectRunning(target.environment.projectPath))
      throw new ExecutionEnvironmentError(
        'GIT_PROJECT_BUSY',
        'Stop active project features before running its init script.'
      );
    this.startInitScript(input);
    return { success: true as const, message: 'Init script started' };
  }

  migrate(input: WorktreeInitGitInput) {
    return {
      success: true as const,
      migrated: false,
      message: 'No migration needed - .automaker is stored in project directory',
      path: getAutomakerDir(input.projectPath),
    };
  }

  prInfo(input: WorktreePrInfoInput, signal: AbortSignal) {
    return this.runPath('pr-info', input.worktreePath, input, signal);
  }

  updatePrNumber(input: WorktreeUpdatePrNumberInput, signal: AbortSignal) {
    return this.runPath('update-pr-number', input.worktreePath, input, signal);
  }

  createPr(input: WorktreeCreatePrInput, signal: AbortSignal) {
    return this.runPath('create-pr', input.worktreePath, input, signal);
  }

  private startInitScript(input: WorktreeRunInitScriptInput) {
    const controller = new AbortController();
    this.events.emit('worktree:init-started', input);
    void this.runPath('run-init-script', input.worktreePath, input, controller.signal)
      .then((response) => {
        const run = response.initScript as {
          success: boolean;
          stdout?: string;
          stderr?: string;
          exitCode?: number;
          skipped?: boolean;
        };
        if (run.stdout)
          this.events.emit('worktree:init-output', {
            projectPath: input.projectPath,
            branch: input.branch,
            type: 'stdout',
            content: run.stdout,
          });
        if (run.stderr)
          this.events.emit('worktree:init-output', {
            projectPath: input.projectPath,
            branch: input.branch,
            type: 'stderr',
            content: run.stderr,
          });
        this.events.emit('worktree:init-completed', {
          ...input,
          success: run.success,
          exitCode: run.exitCode,
          skipped: run.skipped,
        });
      })
      .catch((error) =>
        this.events.emit('worktree:init-completed', {
          ...input,
          success: false,
          error: this.message(error),
          outcome: 'unknown',
        })
      );
  }

  async commitLog(input: WorktreeCommitLogInput, signal: AbortSignal) {
    this.events.emit('commitLog:start', input);
    try {
      const response = await this.runPath('commit-log', input.worktreePath, input, signal);
      const result = response.result as { branch: string; total: number };
      this.events.emit('commitLog:progress', {
        worktreePath: input.worktreePath,
        branch: result.branch,
        commitsLoaded: result.total,
      });
      this.events.emit('commitLog:complete', {
        worktreePath: input.worktreePath,
        branch: result.branch,
        total: result.total,
      });
      return response;
    } catch (error) {
      this.events.emit('commitLog:error', { error: this.message(error) });
      throw error;
    }
  }

  async branchCommitLog(input: WorktreeBranchCommitLogInput, signal: AbortSignal) {
    this.events.emit('branchCommitLog:start', {
      ...input,
      branchName: input.branchName ?? 'HEAD',
    });
    try {
      const response = await this.runPath('branch-commit-log', input.worktreePath, input, signal);
      const result = response.result as { branch: string; total: number };
      this.events.emit('branchCommitLog:progress', {
        worktreePath: input.worktreePath,
        branchName: result.branch,
        commitsLoaded: result.total,
      });
      this.events.emit('branchCommitLog:done', {
        worktreePath: input.worktreePath,
        branchName: result.branch,
        total: result.total,
      });
      return response;
    } catch (error) {
      this.events.emit('branchCommitLog:error', { error: this.message(error) });
      throw error;
    }
  }

  private async runFeature(
    action: string,
    input: WorktreeFeatureInput & Record<string, unknown>,
    signal: AbortSignal
  ) {
    const managed =
      input.useWorktrees === false
        ? await this.git.resolve(input.projectPath, input.featureId)
        : undefined;
    const featureId = input.useWorktrees === false ? undefined : input.featureId;
    const target = managed ?? (await this.git.resolveOrLocal(input.projectPath, featureId));
    return this.git.run(target, action, input, signal);
  }

  private async runPath(
    action: string,
    requested: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ) {
    const target = await this.git.resolveOrLocal(requested);
    const effectiveBody = {
      ...body,
      ...(gitWriteActions.has(action) &&
      !body.environmentTargetId &&
      target.runtime.type === 'local' &&
      !target.binding
        ? { environmentTargetId: target.environment.targetId }
        : {}),
    };
    const operation = async () => {
      if (
        gitWriteActions.has(action) &&
        (await this.autoMode.isProjectRunning(target.environment.projectPath))
      ) {
        throw new ExecutionEnvironmentError(
          'GIT_PROJECT_BUSY',
          'Stop active project features before changing Git state from the UI.'
        );
      }
      return this.git.run(target, action, effectiveBody, signal);
    };
    return gitWriteActions.has(action)
      ? sshSerialized(`git-ui\0${target.environment.projectPath}`, operation)
      : operation();
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
