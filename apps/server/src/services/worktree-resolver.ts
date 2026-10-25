import { EnvironmentBindingStore } from './execution-environment/bindings.js';
import { createLocalMergeExecutor, isMissingGitRepository } from './merge-service.js';
import { uncertainExecution } from './feature-execution-uncertainty.js';
import { ExecutionEnvironmentError } from './execution-environment/runtime.js';
import { TimeoutDomainError, UnavailableDomainError } from '../core/errors/domain-errors.js';

/**
 * WorktreeResolver - Git worktree discovery and resolution
 *
 * Extracted from AutoModeService to provide a standalone service for:
 * - Finding existing worktrees for a given branch
 * - Getting the current branch of a repository
 * - Listing all worktrees with their metadata
 *
 * Key behaviors:
 * - Parses `git worktree list --porcelain` output
 * - Always resolves paths to absolute (cross-platform compatibility)
 * - Handles detached HEAD and bare worktrees gracefully
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { SettingsService } from './settings-service.js';

const execAsync = promisify(exec);

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name (without refs/heads/ prefix), or null if detached HEAD */
  branch: string | null;
  /** Whether this is the main worktree (first in git worktree list) */
  isMain: boolean;
}

/**
 * WorktreeResolver handles git worktree discovery and path resolution.
 *
 * This service is responsible for:
 * 1. Finding existing worktrees by branch name
 * 2. Getting the current branch of a repository
 * 3. Listing all worktrees with normalized paths
 */
export interface WorktreeQueryPolicy {
  timeoutMs?: number;
  shutdownMs?: number;
  maximum?: number;
}
export class WorktreeResolver {
  private readonly environment?: Readonly<NodeJS.ProcessEnv>;
  private readonly queries = new Set<{
    controller: AbortController;
    done: Promise<unknown>;
    unconfirmed: boolean;
  }>();
  private stopping = false;
  private shutdown?: Promise<void>;
  private readonly policy: Readonly<WorktreeQueryPolicy>;
  constructor(
    private readonly settings?: SettingsService | null,
    environment?: Readonly<NodeJS.ProcessEnv>,
    policy: WorktreeQueryPolicy = {}
  ) {
    this.environment = environment === undefined ? undefined : Object.freeze({ ...environment });
    this.policy = Object.freeze({ ...policy });
  }

  private read<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.stopping)
      return Promise.reject(new UnavailableDomainError('Git discovery is shutting down.'));
    if (
      this.queries.size >= (this.policy.maximum ?? 16) ||
      [...this.queries].some((query) => query.unconfirmed)
    )
      return Promise.reject(
        new UnavailableDomainError('Git discovery cannot accept another query.')
      );
    const controller = new AbortController();
    const query = { controller, done: Promise.resolve() as Promise<unknown>, unconfirmed: false };
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, this.policy.timeoutMs ?? 30000);
    const task = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return action(controller.signal);
      })
      .then((value) => {
        controller.signal.throwIfAborted();
        return value;
      })
      .catch((error) => {
        if (uncertainExecution(error)) {
          query.unconfirmed = true;
          throw error;
        }
        if (expired) throw new TimeoutDomainError('Git discovery query timed out.');
        if (controller.signal.aborted)
          throw new UnavailableDomainError('Git discovery query was cancelled.');
        throw error;
      })
      .finally(() => {
        clearTimeout(timer);
        if (!query.unconfirmed) this.queries.delete(query);
      });
    query.done = task;
    this.queries.add(query);
    return task;
  }

  private async requireLocalTopology(projectPath: string, signal: AbortSignal): Promise<void> {
    if (!this.environment || !this.settings) return;
    const state = await new EnvironmentBindingStore(
      this.settings,
      undefined,
      undefined,
      this.environment
    ).configuration(projectPath);
    signal.throwIfAborted();
    if (state.resolved.type === 'ssh')
      throw new ExecutionEnvironmentError(
        'SSH_PROJECT_REQUIRED',
        'Use authoritative SSH worktree discovery. Controller Git was not executed.'
      );
  }
  private async local(args: string[], projectPath: string, signal: AbortSignal): Promise<string> {
    if (this.environment)
      return createLocalMergeExecutor(this.environment, signal).execute(args, projectPath);
    return (await execAsync('git ' + args.join(' '), { cwd: projectPath })).stdout;
  }
  private preserveFailure(error: unknown, signal: AbortSignal): void {
    if (!this.environment) return;
    if (uncertainExecution(error) || signal.aborted) throw error;
    if (!isMissingGitRepository(error))
      throw new UnavailableDomainError('Git discovery query failed.');
  }
  stopAdmission(): void {
    this.stopping = true;
    for (const query of this.queries) query.controller.abort();
  }
  close(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopAdmission();
    const accepted = [...this.queries];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failure = () =>
      new ExecutionEnvironmentError(
        'PROCESS_CLEANUP_FAILED',
        'Git discovery cleanup could not be confirmed. No replacement query was started.',
        503
      );
    this.shutdown = Promise.race([
      Promise.allSettled(accepted.map((query) => query.done)).then(() => {
        if (accepted.some((query) => query.unconfirmed)) throw failure();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          for (const query of accepted) query.unconfirmed = true;
          reject(failure());
        }, this.policy.shutdownMs ?? 3000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
  runtimeDiagnostics(): { active: number; unconfirmed: number } {
    return {
      active: this.queries.size,
      unconfirmed: [...this.queries].filter((query) => query.unconfirmed).length,
    };
  }
  private normalizeBranchName(branchName: string | null | undefined): string | null {
    if (!branchName) return null;
    let normalized = branchName.trim();
    if (!normalized) return null;

    normalized = normalized.replace(/^refs\/heads\//, '');
    normalized = normalized.replace(/^refs\/remotes\/[^/]+\//, '');
    normalized = normalized.replace(/^(origin|upstream)\//, '');

    return normalized || null;
  }

  /**
   * Get the current branch name for a git repository
   *
   * @param projectPath - Path to the git repository
   * @returns The current branch name, or null if not in a git repo or on detached HEAD
   */
  getCurrentBranch(projectPath: string): Promise<string | null> {
    return this.read((signal) => this.currentBranch(projectPath, signal));
  }
  private async currentBranch(projectPath: string, signal: AbortSignal): Promise<string | null> {
    // AutoMode's primary-branch filtering must follow the authoritative SSH checkout.
    // Keep this outside the legacy catch: an SSH failure never authorizes local Git.
    if (this.settings) {
      const { SSHFeatureService } = await import('./execution-environment/ssh-feature.js');
      const remote = await new SSHFeatureService(
        this.settings,
        undefined,
        this.environment
      ).projectBranch(projectPath, signal);
      if (remote !== undefined) return remote;
    }
    try {
      const stdout = await this.local(['branch', '--show-current'], projectPath, signal);
      const branch = stdout.trim();
      return branch || null;
    } catch (error) {
      this.preserveFailure(error, signal);
      return null;
    }
  }

  /**
   * Find an existing worktree for a given branch name
   *
   * @param projectPath - Path to the git repository (main worktree)
   * @param branchName - Branch name to find worktree for
   * @returns Absolute path to the worktree, or null if not found
   */
  findWorktreeForBranch(projectPath: string, branchName: string): Promise<string | null> {
    return this.read((signal) => this.findWorktree(projectPath, branchName, signal));
  }
  private async findWorktree(
    projectPath: string,
    branchName: string,
    signal: AbortSignal
  ): Promise<string | null> {
    await this.requireLocalTopology(projectPath, signal);
    try {
      const normalizedTargetBranch = this.normalizeBranchName(branchName);
      if (!normalizedTargetBranch) return null;

      const stdout = await this.local(['worktree', 'list', '--porcelain'], projectPath, signal);

      const lines = stdout.split('\n');
      let currentPath: string | null = null;
      let currentBranch: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.slice(9);
        } else if (line.startsWith('branch ')) {
          currentBranch = this.normalizeBranchName(line.slice(7));
        } else if (line === '' && currentPath && currentBranch) {
          // End of a worktree entry
          if (currentBranch === normalizedTargetBranch) {
            // Resolve to absolute path - git may return relative paths
            // On Windows, this is critical for cwd to work correctly
            // On all platforms, absolute paths ensure consistent behavior
            return this.resolvePath(projectPath, currentPath);
          }
          currentPath = null;
          currentBranch = null;
        }
      }

      // Check the last entry (if file doesn't end with newline)
      if (currentPath && currentBranch && currentBranch === normalizedTargetBranch) {
        return this.resolvePath(projectPath, currentPath);
      }

      return null;
    } catch (error) {
      this.preserveFailure(error, signal);
      return null;
    }
  }

  /**
   * List all worktrees for a repository
   *
   * @param projectPath - Path to the git repository
   * @returns Array of WorktreeInfo objects with normalized paths
   */
  listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    return this.read((signal) => this.worktrees(projectPath, signal));
  }
  private async worktrees(projectPath: string, signal: AbortSignal): Promise<WorktreeInfo[]> {
    await this.requireLocalTopology(projectPath, signal);
    try {
      const stdout = await this.local(['worktree', 'list', '--porcelain'], projectPath, signal);

      const worktrees: WorktreeInfo[] = [];
      const lines = stdout.split('\n');
      let currentPath: string | null = null;
      let currentBranch: string | null = null;
      let isFirstWorktree = true;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.slice(9);
        } else if (line.startsWith('branch ')) {
          currentBranch = this.normalizeBranchName(line.slice(7));
        } else if (line.startsWith('detached')) {
          // Detached HEAD - branch is null
          currentBranch = null;
        } else if (line === '' && currentPath) {
          // End of a worktree entry
          worktrees.push({
            path: this.resolvePath(projectPath, currentPath),
            branch: currentBranch,
            isMain: isFirstWorktree,
          });
          currentPath = null;
          currentBranch = null;
          isFirstWorktree = false;
        }
      }

      // Handle last entry if file doesn't end with newline
      if (currentPath) {
        worktrees.push({
          path: this.resolvePath(projectPath, currentPath),
          branch: currentBranch,
          isMain: isFirstWorktree,
        });
      }

      return worktrees;
    } catch (error) {
      this.preserveFailure(error, signal);
      return [];
    }
  }

  /**
   * Resolve a path to absolute, handling both relative and absolute inputs
   *
   * @param projectPath - Base path for relative resolution
   * @param worktreePath - Path from git worktree list output
   * @returns Absolute path
   */
  private resolvePath(projectPath: string, worktreePath: string): string {
    return path.isAbsolute(worktreePath)
      ? path.resolve(worktreePath)
      : path.resolve(projectPath, worktreePath);
  }
}
