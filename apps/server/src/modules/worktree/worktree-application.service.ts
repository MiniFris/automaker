import { Inject, Injectable } from '@nestjs/common';
import type { EventEmitter } from '../../lib/events.js';
import { LEGACY_EVENT_EMITTER } from '../../legacy/legacy.tokens.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import type {
  WorktreeBranchesRequest,
  WorktreeBranchCommitLogRequest,
  WorktreeCommitLogRequest,
  WorktreeFeatureRequest,
  WorktreeFileRequest,
  WorktreePathRequest,
  WorktreeProjectRequest,
} from './worktree.schemas.js';

@Injectable()
export class WorktreeApplicationService {
  constructor(
    @Inject(ProjectGitService) private readonly git: ProjectGitService,
    @Inject(LEGACY_EVENT_EMITTER) private readonly events: EventEmitter
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
    return this.git.run(target, action, body, signal);
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
