import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePath } from '@automaker/platform';
import type { ExecutionEnvironmentBinding, ProjectGitEnvironment } from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import { EnvironmentBindingStore } from './bindings.js';
import { ManagedDocker, DockerExecutionEnvironment } from './docker.js';
import { ManagedSSH, SSHExecutionEnvironment } from './ssh.js';
import { boundRuntime } from './bound-runtime.js';
import { ExecutionEnvironmentError, type ExecutionEnvironment } from './runtime.js';
import { LocalExecutionEnvironment } from './local.js';
import { nodeCommand } from './ssh-transport.js';
import { PROJECT_GIT_WORKER } from './project-git-worker.js';

const fail = (code: string, message: string): never => {
  throw new ExecutionEnvironmentError(code, message, code === 'GIT_REMOTE_ADD_FAILED' ? 500 : 400);
};
const identityHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const gitReadActions = new Set([
  'environment',
  'list',
  'info',
  'status',
  'diffs',
  'file-diff',
  'enhanced-status',
  'details',
  'check-changes',
  'list-branches',
  'list-remotes',
  'commit-log',
  'branch-commit-log',
  'stash-list',
  'init-script-get',
  'commit-message-context',
  'pr-description-context',
  'pr-info',
]);
export const gitWriteActions = new Set([
  'stage-files',
  'commit',
  'create',
  'abort-operation',
  'continue-operation',
  'add-remote',
  'set-tracking',
  'stash-push',
  'stash-apply',
  'stash-drop',
  'checkout-branch',
  'switch-branch',
  'discard-changes',
  'pull',
  'push',
  'sync',
  'rebase',
  'cherry-pick',
  'merge',
  'delete',
  'init-git',
  'init-script-put',
  'init-script-delete',
  'run-init-script',
  'update-pr-number',
  'create-pr',
]);
export function workspaceAlias(binding: ExecutionEnvironmentBinding) {
  const root = binding.ssh?.remotePath ?? binding.projectPath;
  const cwd = binding.runtimeCwd ?? binding.cwd;
  const relative = path.posix.relative(root, cwd);
  if (relative.startsWith('../') || path.posix.isAbsolute(relative)) return undefined;
  return path.resolve(binding.projectPath, relative);
}
export interface ProjectGitTarget {
  environment: ProjectGitEnvironment;
  runtime: ExecutionEnvironment;
  root: string;
  binding?: ExecutionEnvironmentBinding;
  identity: unknown;
  workspaceBranch?: string;
}

/** Resolves only saved project targets / pinned workspaces; no preparation or fallback on poll. */
export class ProjectGitService {
  private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  constructor(
    private readonly settings: SettingsService,
    private readonly docker = new ManagedDocker(settings),
    private readonly ssh = new ManagedSSH(settings),
    hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
  ) {
    this.hostEnvironment = Object.freeze({ ...hostEnvironment });
  }

  async pinnedEntries(projectPath: string) {
    const pins = await new EnvironmentBindingStore(
      this.settings,
      undefined,
      undefined,
      this.hostEnvironment
    ).workspaceBindings(projectPath);
    return pins.flatMap((pin) => {
      const alias = workspaceAlias(pin);
      if (
        !alias ||
        !pin.runtimeCwd ||
        pin.featurePreparation ||
        pin.type === 'legacy' ||
        (pin.type === 'local' && !pin.featureWorkspace)
      )
        return [];
      const environment: ProjectGitEnvironment = {
        type: pin.type,
        projectPath: pin.projectPath,
        path: alias,
        runtimeCwd: pin.runtimeCwd,
        root: pin.ssh?.remotePath ?? pin.projectPath,
        pinned: true,
        targetId: createHash('sha256')
          .update(JSON.stringify([pin, pin.runtimeCwd]))
          .digest('hex'),
      };
      return [
        {
          path: alias,
          runtimePath: pin.runtimeCwd,
          branch: (pin.featureWorkspace ?? pin.sshWorkspace)?.branch ?? 'HEAD',
          isMain: false,
          isCurrent: false,
          hasWorktree: true,
          runtimeIdentity: identityHash(pin.ssh ?? pin.docker ?? pin.serverIdentity),
          executionEnvironment: environment,
        },
      ];
    });
  }

  async resolve(requested: string, featureId?: string): Promise<ProjectGitTarget | undefined> {
    if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0'))
      fail('GIT_PATH_REQUIRED', 'An absolute controller project/worktree alias is required.');
    const normalized = path.resolve(requested);
    const separator = path.sep + '.worktrees' + path.sep;
    const rootHint = normalized.includes(separator)
      ? normalized.slice(0, normalized.indexOf(separator))
      : normalized;
    validatePath(rootHint);
    const projectPath = await fs.realpath(rootHint);
    validatePath(projectPath);
    const alias = path.resolve(projectPath, path.relative(rootHint, normalized));
    const store = new EnvironmentBindingStore(
      this.settings,
      undefined,
      undefined,
      this.hostEnvironment
    );
    const pins = await store.workspaceBindings(projectPath);
    let binding = featureId
      ? await store.peek(projectPath, `feature:${projectPath}:${featureId}`)
      : pins.find((item) => workspaceAlias(item) === alias);
    if (!binding && featureId) {
      // The existing UI also sends a branch name as featureId. Resolve it only from saved metadata.
      const matches = pins.filter(
        (item) => (item.featureWorkspace ?? item.sshWorkspace)?.branch === featureId
      );
      if (matches.length > 1)
        fail(
          'GIT_WORKSPACE_AMBIGUOUS',
          'More than one pinned workspace matches this branch. Select its explicit path.'
        );
      binding = matches[0];
    }
    let runtime: ExecutionEnvironment, root: string, identity: unknown;
    if (binding) {
      if (binding.featurePreparation)
        fail(
          'FEATURE_WORKSPACE_REQUIRED',
          'Feature workspace preparation is incomplete. Start/resume the feature; Git UI will not create or repair it.'
        );
      if (binding.type === 'legacy' || (binding.type === 'local' && !binding.featureWorkspace))
        return undefined;
      runtime = await boundRuntime(binding, this.settings, this.hostEnvironment);
      root = binding.ssh?.remotePath ?? projectPath;
      identity = binding;
    } else {
      const state = await store.configuration(projectPath);
      if (!state.explicit || state.resolved.type === 'local') return undefined;
      if (state.resolved.type === 'ssh' && state.resolved.profile?.type === 'ssh') {
        const profile = state.resolved.profile;
        const trusted = await this.ssh.state.trust(profile);
        const saved = trusted
          ? await this.ssh.state.project(profile, trusted.fingerprint, projectPath)
          : undefined;
        if (!saved?.ready)
          fail(
            'SSH_PROJECT_REQUIRED',
            'Prepare the authoritative SSH checkout in Project Settings. Git browsing never creates it.'
          );
        const descriptor = { ...saved!, profile };
        root = descriptor.remotePath;
        runtime = new SSHExecutionEnvironment(
          this.ssh,
          descriptor,
          path.posix.join(root, path.relative(projectPath, alias).split(path.sep).join('/'))
        );
        identity = [descriptor, state.resolved.selection];
      } else if (['docker', 'auto'].includes(state.resolved.type)) {
        const descriptor = await this.docker.existing(
          projectPath,
          state.resolved.profile?.type === 'docker' ? state.resolved.profile.context : undefined
        );
        if (!descriptor)
          fail(
            'DOCKER_PROJECT_REQUIRED',
            'Prepare the saved Docker project in Project Settings. Git browsing never creates containers or falls back to Local.'
          );
        root = projectPath;
        runtime = new DockerExecutionEnvironment(this.docker, descriptor!, alias);
        identity = [descriptor, state.resolved.selection];
      } else
        fail(
          'GIT_ENVIRONMENT_UNAVAILABLE',
          'Selected execution environment is unavailable. No controller Git was used.'
        );
    }
    const effectiveAlias = binding ? workspaceAlias(binding)! : alias;
    const environment: ProjectGitEnvironment = {
      type: runtime!.type,
      projectPath,
      path: effectiveAlias,
      runtimeCwd: runtime!.cwd,
      root: root!,
      pinned: !!binding,
      targetId: createHash('sha256')
        .update(JSON.stringify([identity, runtime!.cwd]))
        .digest('hex'),
    };
    return {
      environment,
      runtime: runtime!,
      root: root!,
      binding,
      identity,
      workspaceBranch: binding ? undefined : featureId,
    };
  }

  /** Resolve a managed target or an explicit controller-local target without preparing either. */
  async resolveOrLocal(requested: string, featureId?: string): Promise<ProjectGitTarget> {
    const managed = await this.resolve(requested, featureId);
    if (managed) return managed;
    const normalized = path.resolve(requested);
    const separator = path.sep + '.worktrees' + path.sep;
    const rootHint = normalized.includes(separator)
      ? normalized.slice(0, normalized.indexOf(separator))
      : normalized;
    validatePath(rootHint);
    const projectPath = await fs.realpath(rootHint);
    const alias = await fs.realpath(path.resolve(projectPath, path.relative(rootHint, normalized)));
    validatePath(alias);
    const runtime = await LocalExecutionEnvironment.create(alias, this.hostEnvironment);
    const targetId = identityHash(['local', projectPath, alias]);
    return {
      environment: {
        type: 'local',
        projectPath,
        path: alias,
        runtimeCwd: runtime.cwd,
        root: projectPath,
        pinned: false,
        targetId,
      },
      runtime,
      root: projectPath,
      identity: ['local', projectPath, alias],
      workspaceBranch: featureId,
    };
  }

  async run(
    target: ProjectGitTarget,
    action: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ) {
    if (!gitReadActions.has(action) && !gitWriteActions.has(action))
      fail(
        'GIT_OPERATION_UNSUPPORTED',
        `The ${action} operation is not migrated for managed environments. No controller command was executed. Use target-side Git explicitly; terminal/dev-server/preview migration is separate.`
      );
    if (!gitReadActions.has(action) && body.environmentTargetId !== target.environment.targetId)
      fail(
        'GIT_TARGET_CHANGED',
        'Inspect this workspace again before changing it: its saved environment target must match the one shown by the UI. No Git mutation was dispatched.'
      );
    if (target.binding) {
      await new EnvironmentBindingStore(
        this.settings,
        undefined,
        undefined,
        this.hostEnvironment
      ).bind({
        projectPath: target.binding.projectPath,
        cwd: target.binding.cwd,
        existingId: target.binding.id,
        legacySettings: {},
        signal,
      });
      if (action === 'create')
        fail(
          'GIT_PINNED_WORKSPACE',
          'Create worktrees from the project root, not a pinned feature.'
        );
    } else if (target.runtime.type === 'docker') {
      const runtime = target.runtime as DockerExecutionEnvironment;
      await this.docker.start(runtime.binding, signal);
      await this.docker.verifyStorage(runtime.binding, signal);
    }
    let workerBody: Record<string, unknown> = {
      ...body,
      workspaceBranch: target.workspaceBranch,
    };
    if (['merge', 'delete'].includes(action) && typeof body.worktreePath === 'string') {
      const source = (
        await new EnvironmentBindingStore(
          this.settings,
          undefined,
          undefined,
          this.hostEnvironment
        ).workspaceBindings(target.environment.projectPath)
      ).find((binding) => workspaceAlias(binding) === path.resolve(body.worktreePath as string));
      if (source) workerBody = { ...workerBody, sourceBindingId: source.id };
    }
    const result = await target.runtime.exec(
      nodeCommand(PROJECT_GIT_WORKER, [
        JSON.stringify({
          action,
          body: workerBody,
          root: target.root,
          cwd: target.runtime.cwd,
          controllerRoot: target.environment.projectPath,
          pinned: !!target.binding,
        }),
      ]),
      signal,
      { timeoutMs: 120000, maxOutputBytes: 4 * 1024 * 1024 }
    );
    if (result.truncated)
      fail(
        'GIT_OUTPUT_LIMIT',
        'Target Git output exceeded its budget. No result was reported as empty/successful; inspect the target before retrying mutations.'
      );
    let response: Record<string, unknown>;
    try {
      response = JSON.parse(result.output);
    } catch {
      fail(
        'GIT_RESULT_UNKNOWN',
        'Invalid target Git response. Inspect target effects before retrying; no controller fallback or replay occurred.'
      );
    }
    if (result.exitCode !== 0 || response!.success !== true)
      fail(
        String(response!.code ?? 'GIT_TARGET_FAILED'),
        String(
          response!.error ??
            'Target Git failed. Inspect the working tree/index; no controller fallback or retry was performed.'
        )
      );
    const described = (
      runtimeCwd: string,
      pin?: ExecutionEnvironmentBinding
    ): ProjectGitEnvironment => ({
      ...target.environment,
      runtimeCwd,
      path: path.resolve(
        target.environment.projectPath,
        path.posix.relative(target.root, runtimeCwd)
      ),
      pinned: !!pin,
      targetId: createHash('sha256')
        .update(JSON.stringify([pin ?? target.identity, runtimeCwd]))
        .digest('hex'),
    });
    const resolvedCwd =
      typeof response!.resolvedCwd === 'string' ? response!.resolvedCwd : target.runtime.cwd;
    delete response!.resolvedCwd;
    const value: Record<string, unknown> = {
      ...response!,
      executionEnvironment: described(resolvedCwd, target.binding),
    };
    if (action === 'merge' || action === 'delete') {
      const lifecycle = (action === 'merge' ? value.result : value.deleted) as
        | {
            worktreeDeleted?: boolean;
            deleted?: { worktreeDeleted?: boolean };
            deletedBindingId?: string;
          }
        | undefined;
      if (
        (lifecycle?.worktreeDeleted || lifecycle?.deleted?.worktreeDeleted) &&
        lifecycle.deletedBindingId
      ) {
        await new EnvironmentBindingStore(
          this.settings,
          undefined,
          undefined,
          this.hostEnvironment
        ).removeWorkspaceBinding(target.environment.projectPath, lifecycle.deletedBindingId);
        delete lifecycle.deletedBindingId;
      }
    }
    if (Array.isArray(value.worktrees)) {
      const pins = await this.pinnedEntries(target.environment.projectPath);
      const currentIdentity = identityHash(
        target.binding
          ? (target.binding.ssh ?? target.binding.docker ?? target.binding.serverIdentity)
          : (target.identity as unknown[])[0]
      );
      value.worktrees = value.worktrees.map((item) => {
        const entry = item as { path: string; runtimePath: string };
        const environment = described(entry.runtimePath);
        const pin = pins.find((pin) => pin.path === environment.path);
        if (pin && pin.runtimeIdentity !== currentIdentity) return { ...pin, metadataOnly: true };
        return {
          ...entry,
          path: environment.path,
          executionEnvironment: pin?.executionEnvironment ?? environment,
        };
      });
      const entries = value.worktrees as Array<{ path: string }>;
      value.worktrees = [
        ...entries,
        ...pins.filter((pin) => !entries.some((entry) => entry.path === pin.path)),
      ];
    }
    return value;
  }
}
