import { Inject, Injectable } from '@nestjs/common';
import { getAutomakerDir } from '@automaker/platform';
import type { EventEmitter } from '../../lib/events.js';
import { LEGACY_EVENT_EMITTER } from '../../legacy/legacy.tokens.js';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import type { AutoModeServiceCompat } from '../../services/auto-mode/index.js';
import type { FeatureLoader } from '../../services/feature-loader.js';
import { SettingsService } from '../../services/settings-service.js';
import {
  ProjectGitService,
  gitWriteActions,
} from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { sshSerialized } from '../../services/execution-environment/ssh-state.js';
import type {
  WorktreeBranchesRequest,
  WorktreeBranchCommitLogRequest,
  WorktreeCommitLogRequest,
  WorktreeCommitRequest,
  WorktreeCheckoutBranchRequest,
  WorktreeCherryPickRequest,
  WorktreeMergeRequest,
  WorktreeCreateRequest,
  WorktreeDeleteRequest,
  WorktreeInitGitRequest,
  WorktreeInitScriptDeleteRequest,
  WorktreeInitScriptQuery,
  WorktreeInitScriptWriteRequest,
  WorktreeRunInitScriptRequest,
  WorktreePrInfoRequest,
  WorktreeUpdatePrNumberRequest,
  WorktreeCreatePrRequest,
  WorktreeDiscardRequest,
  WorktreeFeatureRequest,
  WorktreeFileRequest,
  WorktreePathRequest,
  WorktreeProjectRequest,
  WorktreePullRequest,
  WorktreePushRequest,
  WorktreeRebaseRequest,
  WorktreeMutationRequest,
  WorktreeRemoteAddRequest,
  WorktreeStashApplyRequest,
  WorktreeStashDropRequest,
  WorktreeStashPushRequest,
  WorktreeStageFilesRequest,
  WorktreeTrackingRequest,
  WorktreeSwitchBranchRequest,
  WorktreeSyncRequest,
} from './worktree.schemas.js';

@Injectable()
export class WorktreeApplicationService {
  constructor(
    @Inject(ProjectGitService) private readonly git: ProjectGitService,
    @Inject(LEGACY_EVENT_EMITTER) private readonly events: EventEmitter,
    @Inject(LEGACY_SERVICES.autoMode) private readonly autoMode: AutoModeServiceCompat,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LEGACY_SERVICES.featureLoader) private readonly features: FeatureLoader
  ) {}

  async environment(input: WorktreeProjectRequest) {
    const target = await this.git.resolveOrLocal(input.projectPath);
    return { success: true as const, executionEnvironment: target.environment };
  }

  list(input: WorktreeProjectRequest, signal: AbortSignal) {
    return this.runPath('list', input.projectPath, input, signal);
  }

  info(input: WorktreeFeatureRequest, signal: AbortSignal) {
    return this.runFeature('info', input, signal);
  }

  status(input: WorktreeFeatureRequest, signal: AbortSignal) {
    return this.runFeature('status', input, signal);
  }

  diffs(input: WorktreeFeatureRequest, signal: AbortSignal) {
    return this.runFeature('diffs', input, signal);
  }

  fileDiff(input: WorktreeFileRequest, signal: AbortSignal) {
    if (input.useWorktrees === false) {
      return Promise.resolve({ success: true as const, diff: '', filePath: input.filePath });
    }
    return this.runFeature('file-diff', input, signal);
  }

  checkChanges(input: WorktreePathRequest, signal: AbortSignal) {
    return this.runPath('check-changes', input.worktreePath, input, signal);
  }

  listBranches(input: WorktreeBranchesRequest, signal: AbortSignal) {
    return this.runPath('list-branches', input.worktreePath, input, signal);
  }

  listRemotes(input: WorktreePathRequest, signal: AbortSignal) {
    return this.runPath('list-remotes', input.worktreePath, input, signal);
  }

  stageFiles(input: WorktreeStageFilesRequest, signal: AbortSignal) {
    return this.runPath('stage-files', input.worktreePath, input, signal);
  }

  commit(input: WorktreeCommitRequest, signal: AbortSignal) {
    return this.runPath('commit', input.worktreePath, input, signal);
  }

  abortOperation(input: WorktreeMutationRequest, signal: AbortSignal) {
    return this.runPath('abort-operation', input.worktreePath, input, signal);
  }

  continueOperation(input: WorktreeMutationRequest, signal: AbortSignal) {
    return this.runPath('continue-operation', input.worktreePath, input, signal);
  }

  addRemote(input: WorktreeRemoteAddRequest, signal: AbortSignal) {
    return this.runPath('add-remote', input.worktreePath, input, signal);
  }

  setTracking(input: WorktreeTrackingRequest, signal: AbortSignal) {
    return this.runPath('set-tracking', input.worktreePath, input, signal);
  }

  stashList(input: WorktreePathRequest, signal: AbortSignal) {
    return this.runPath('stash-list', input.worktreePath, input, signal);
  }

  stashPush(input: WorktreeStashPushRequest, signal: AbortSignal) {
    return this.runPath('stash-push', input.worktreePath, input, signal);
  }

  stashApply(input: WorktreeStashApplyRequest, signal: AbortSignal) {
    return this.runPath('stash-apply', input.worktreePath, input, signal);
  }

  stashDrop(input: WorktreeStashDropRequest, signal: AbortSignal) {
    return this.runPath('stash-drop', input.worktreePath, input, signal);
  }

  checkoutBranch(input: WorktreeCheckoutBranchRequest, signal: AbortSignal) {
    return this.runPath('checkout-branch', input.worktreePath, input, signal);
  }

  switchBranch(input: WorktreeSwitchBranchRequest, signal: AbortSignal) {
    return this.runPath('switch-branch', input.worktreePath, input, signal);
  }

  discardChanges(input: WorktreeDiscardRequest, signal: AbortSignal) {
    return this.runPath('discard-changes', input.worktreePath, input, signal);
  }

  pull(input: WorktreePullRequest, signal: AbortSignal) {
    return this.runPath('pull', input.worktreePath, input, signal);
  }

  push(input: WorktreePushRequest, signal: AbortSignal) {
    return this.runPath('push', input.worktreePath, input, signal);
  }

  sync(input: WorktreeSyncRequest, signal: AbortSignal) {
    return this.runPath('sync', input.worktreePath, input, signal);
  }

  rebase(input: WorktreeRebaseRequest, signal: AbortSignal) {
    return this.runPath('rebase', input.worktreePath, input, signal);
  }

  async cherryPick(input: WorktreeCherryPickRequest, signal: AbortSignal) {
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

  async merge(input: WorktreeMergeRequest, signal: AbortSignal) {
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

  async create(input: WorktreeCreateRequest, signal: AbortSignal) {
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

  async delete(input: WorktreeDeleteRequest, signal: AbortSignal) {
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

  initGit(input: WorktreeInitGitRequest, signal: AbortSignal) {
    return this.runPath('init-git', input.projectPath, input, signal);
  }

  getInitScript(input: WorktreeInitScriptQuery, signal: AbortSignal) {
    return this.runPath('init-script-get', input.projectPath, input, signal);
  }

  putInitScript(input: WorktreeInitScriptWriteRequest, signal: AbortSignal) {
    return this.runPath('init-script-put', input.projectPath, input, signal);
  }

  deleteInitScript(input: WorktreeInitScriptDeleteRequest, signal: AbortSignal) {
    return this.runPath('init-script-delete', input.projectPath, input, signal);
  }

  runInitScript(input: WorktreeRunInitScriptRequest) {
    this.startInitScript(input);
    return { success: true as const, message: 'Init script started' };
  }

  migrate(input: WorktreeInitGitRequest) {
    return {
      success: true as const,
      migrated: false,
      message: 'No migration needed - .automaker is stored in project directory',
      path: getAutomakerDir(input.projectPath),
    };
  }

  prInfo(input: WorktreePrInfoRequest, signal: AbortSignal) {
    return this.runPath('pr-info', input.worktreePath, input, signal);
  }

  updatePrNumber(input: WorktreeUpdatePrNumberRequest, signal: AbortSignal) {
    return this.runPath('update-pr-number', input.worktreePath, input, signal);
  }

  createPr(input: WorktreeCreatePrRequest, signal: AbortSignal) {
    return this.runPath('create-pr', input.worktreePath, input, signal);
  }

  private startInitScript(input: WorktreeRunInitScriptRequest) {
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

  async commitLog(input: WorktreeCommitLogRequest, signal: AbortSignal) {
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

  async branchCommitLog(input: WorktreeBranchCommitLogRequest, signal: AbortSignal) {
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
    input: WorktreeFeatureRequest & Record<string, unknown>,
    signal: AbortSignal
  ) {
    const featureId = input.useWorktrees === false ? undefined : input.featureId;
    const target = await this.git.resolveOrLocal(input.projectPath, featureId);
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
      ...(gitWriteActions.has(action) && !body.environmentTargetId
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
