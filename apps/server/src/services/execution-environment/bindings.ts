import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteJson } from '@automaker/utils';
import type {
  DirectAgentSettings,
  ExecutionEnvironmentBinding,
  LocalExecutionConsentStatus,
} from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import { ManagedDocker, DockerPreflightError, DockerExecutionEnvironment } from './docker.js';
import { ManagedSSH } from './ssh.js';
import { LocalExecutionEnvironment } from './local.js';
import {
  prepareManagedFeatureWorkspace,
  verifyManagedFeatureWorkspace,
} from './managed-feature-workspace.js';
import {
  defaultEnvironmentSettings,
  EnvironmentConfigurationError,
  parseEnvironmentSettings,
  parseEnvironmentSelection,
  resolveEnvironment,
} from './config.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const writes = new Map<string, Promise<unknown>>();
async function serialized<T>(file: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(work);
  writes.set(file, next);
  try {
    return await next;
  } finally {
    if (writes.get(file) === next) writes.delete(file);
  }
}
async function read(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new EnvironmentConfigurationError(
      'Environment state is unreadable. Inspect server state before retrying.'
    );
  }
}

export class EnvironmentBindingStore {
  readonly serverIdentity: string;
  private readonly directory: string;
  constructor(
    private readonly settings: SettingsService,
    private readonly docker = new ManagedDocker(settings),
    private readonly ssh = new ManagedSSH(settings)
  ) {
    this.directory = path.join(settings.getDataDirectory(), 'execution-environments');
    const user = os.userInfo();
    this.serverIdentity = digest(
      `${os.hostname()}\0${process.platform}\0${user.uid}\0${user.username}\0${path.resolve(settings.getDataDirectory())}`
    );
  }
  private consentFile(scope: string, fallback = false): string {
    return path.join(
      this.directory,
      `${fallback ? 'auto-fallback' : 'consent'}-${digest(scope)}.json`
    );
  }
  /** Container hostnames change on recreation; consent belongs to the persisted installation. */
  private async consentIdentity(create = false): Promise<string | undefined> {
    if (process.env.IS_CONTAINERIZED !== 'true') return this.serverIdentity;
    const file = path.join(this.directory, 'container-installation.json');
    return serialized(file, async () => {
      let installation = (await read(file)) as { version?: number; id?: string } | undefined;
      if (installation === undefined && create) {
        installation = { version: 1, id: randomUUID() };
        await fs.mkdir(this.directory, { recursive: true });
        await atomicWriteJson(file, installation, { mode: 0o600 });
      }
      if (installation === undefined) return undefined;
      if (
        installation?.version !== 1 ||
        typeof installation.id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          installation.id
        )
      )
        throw new EnvironmentConfigurationError(
          'Container installation identity is invalid. Inspect server state before retrying.'
        );
      const user = os.userInfo();
      return digest(
        `container\0${installation.id}\0${process.platform}\0${user.uid}\0${user.username}\0${path.resolve(this.settings.getDataDirectory())}`
      );
    });
  }
  async configuration(projectPath?: string) {
    const global = await this.settings.getGlobalSettings();
    const project = projectPath ? await this.settings.getProjectSettings(projectPath) : undefined;
    const config = parseEnvironmentSettings(
      global.executionEnvironment ?? defaultEnvironmentSettings()
    );
    const override =
      project?.executionEnvironment == null
        ? null
        : parseEnvironmentSelection(project.executionEnvironment);
    return {
      config,
      override,
      resolved: resolveEnvironment(config, override),
      explicit: global.executionEnvironment !== undefined || override !== null,
    };
  }
  /** Routing metadata only, never an execution capability. Pinned mode wins over settings. */
  async peek(projectPath: string, key: string): Promise<ExecutionEnvironmentBinding | undefined> {
    const stored = (await read(path.join(this.directory, 'bindings', `${digest(key)}.json`))) as
      | { binding?: ExecutionEnvironmentBinding }
      | undefined;
    const binding = stored?.binding;
    if (
      stored &&
      (!binding ||
        binding.version !== 1 ||
        binding.id !== digest(key) ||
        binding.projectPath !== (await fs.realpath(projectPath)))
    )
      throw new EnvironmentConfigurationError(
        'Pinned environment metadata does not match this project.'
      );
    return binding;
  }
  async usesSSH(projectPath: string, key: string) {
    const stored = (await read(path.join(this.directory, 'bindings', `${digest(key)}.json`))) as
      | { binding?: ExecutionEnvironmentBinding }
      | undefined;
    return stored?.binding
      ? stored.binding.type === 'ssh'
      : (await this.configuration(projectPath)).resolved.type === 'ssh';
  }
  /** Metadata only: find pinned workspaces without connecting to their target. */
  async workspaceBindings(projectPath: string): Promise<ExecutionEnvironmentBinding[]> {
    const canonical = await fs.realpath(projectPath);
    const directory = path.join(this.directory, 'bindings');
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (names.length > 10000)
      throw new EnvironmentConfigurationError(
        'Too many environment bindings to inspect. Archive old server bindings before listing workspaces.'
      );
    const result: ExecutionEnvironmentBinding[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const value = (await read(path.join(directory, name))) as
        | { binding?: ExecutionEnvironmentBinding }
        | undefined;
      const binding = value?.binding;
      if (binding?.projectPath !== canonical) continue;
      if (binding.version !== 1 || binding.id !== name.slice(0, -5))
        throw new EnvironmentConfigurationError('Invalid project workspace binding.');
      if (binding.runtimeCwd || binding.cwd !== canonical) result.push(binding);
    }
    return result;
  }
  async consent(projectPath?: string): Promise<LocalExecutionConsentStatus> {
    const projectScope = projectPath ? await fs.realpath(projectPath) : undefined;
    const identity = await this.consentIdentity();
    let scope: 'global' | 'project' | null = null;
    let autoScope: 'global' | 'project' | null = null;
    for (const candidate of [
      ...(projectScope ? [{ key: projectScope, scope: 'project' as const }] : []),
      { key: 'global', scope: 'global' as const },
    ]) {
      for (const fallback of [false, true]) {
        const grant = (await read(this.consentFile(candidate.key, fallback))) as
          | { version?: number; serverIdentity?: string; scope?: string }
          | undefined;
        if (
          grant?.version === 1 &&
          // Keep pre-upgrade grants valid only on the exact server that issued them.
          (grant.serverIdentity === this.serverIdentity ||
            (identity !== undefined && grant.serverIdentity === identity)) &&
          grant.scope === candidate.key
        ) {
          if (fallback) autoScope ??= candidate.scope;
          else scope ??= candidate.scope;
        }
      }
    }
    const state = await this.configuration(projectPath);
    return {
      warningVersion: 1,
      confirmed: scope !== null,
      scope,
      legacy: !state.explicit,
      serverContainerized: process.env.IS_CONTAINERIZED === 'true',
      autoFallbackConfirmed: autoScope !== null,
      autoFallbackScope: autoScope,
    };
  }
  async confirm(projectPath?: string, fallback = false): Promise<void> {
    const scope = projectPath ? await fs.realpath(projectPath) : 'global';
    const state = await this.configuration(projectPath);
    if (state.resolved.type !== (fallback ? 'auto' : 'local'))
      throw new EnvironmentConfigurationError(
        `Save ${fallback ? 'Auto' : 'Local'} as the selected environment before confirming access.`
      );
    // Confirmation is the explicit migration action; an absent legacy setting never grants Local.
    if (!state.explicit) {
      if (projectPath)
        await this.settings.updateProjectSettings(projectPath, {
          executionEnvironment: { mode: 'local' },
        });
      else
        await this.settings.updateGlobalSettings({
          executionEnvironment: defaultEnvironmentSettings(),
        });
    }
    const file = this.consentFile(scope, fallback);
    const identity = await this.consentIdentity(true);
    await serialized(file, async () => {
      await fs.mkdir(this.directory, { recursive: true });
      await atomicWriteJson(
        file,
        {
          version: 1,
          serverIdentity: identity,
          scope,
          confirmedAt: new Date().toISOString(),
        },
        { mode: 0o600 }
      );
    });
  }
  async revoke(projectPath?: string, fallback = false): Promise<void> {
    const scope = projectPath ? await fs.realpath(projectPath) : 'global';
    const file = this.consentFile(scope, fallback);
    await serialized(file, async () => {
      await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    });
  }
  async bind(input: {
    cwd: string;
    projectPath: string;
    key?: string;
    legacySettings: DirectAgentSettings;
    signal?: AbortSignal;
    sshFeature?: { targetBranch?: string | null };
    /** Managed Docker/Auto feature, including an explicitly authorized Local fallback. */
    feature?: { targetBranch?: string | null };
    /** Internal reopen of a metadata-resolved binding, never a request-supplied grant. */
    existingId?: string;
  }): Promise<{ binding: ExecutionEnvironmentBinding; legacySettings?: DirectAgentSettings }> {
    const cwd = await fs.realpath(input.cwd);
    const projectPath = await fs.realpath(input.projectPath);
    if (input.existingId && !/^[a-f0-9]{64}$/.test(input.existingId))
      throw new EnvironmentConfigurationError('Invalid existing binding identity.');
    const id = input.existingId ?? digest(input.key ?? randomUUID());
    const file = path.join(this.directory, 'bindings', `${id}.json`);
    return serialized(file, async () => {
      const stored = (await read(file)) as
        | { binding?: ExecutionEnvironmentBinding; legacySettings?: DirectAgentSettings }
        | undefined;
      if (stored) {
        const binding = stored.binding;
        if (
          !binding ||
          binding.version !== 1 ||
          binding.id !== id ||
          binding.cwd !== cwd ||
          binding.projectPath !== projectPath ||
          !['legacy', 'local', 'docker', 'ssh'].includes(binding.type)
        )
          throw new EnvironmentConfigurationError(
            'Pinned environment no longer matches this server or working copy. Start a new session/task; no fallback was performed.'
          );
        if (binding.type === 'local')
          await this.requireConsent(projectPath, !!binding.fallbackReason);
        if (binding.type === 'docker') {
          if (!binding.docker || binding.docker.projectPath !== projectPath)
            throw new EnvironmentConfigurationError(
              'Pinned Docker descriptor is missing or does not match this project.'
            );
          await this.docker.start(binding.docker, input.signal);
          await this.docker.verifyStorage(binding.docker, input.signal);
        }
        if (binding.featurePreparation) {
          if (
            !['docker', 'local'].includes(binding.type) ||
            (input.feature?.targetBranch &&
              input.feature.targetBranch !== binding.featurePreparation.targetBranch)
          )
            throw new EnvironmentConfigurationError(
              'Pinned feature preparation changed. No migration was performed.'
            );
          const environment =
            binding.type === 'docker'
              ? new DockerExecutionEnvironment(this.docker, binding.docker!, projectPath)
              : await LocalExecutionEnvironment.create(projectPath);
          const prepared = await prepareManagedFeatureWorkspace({
            environment,
            directory: this.directory,
            id,
            root: projectPath,
            targetBranch: binding.featurePreparation.targetBranch,
            signal: input.signal ?? new AbortController().signal,
          });
          binding.runtimeCwd = prepared.runtimeCwd;
          binding.featureWorkspace = prepared.workspace;
          delete binding.featurePreparation;
          await atomicWriteJson(file, { binding }, { mode: 0o600 });
        }
        if ((input.feature && binding.type === 'docker') || binding.featureWorkspace) {
          if (
            !binding.featureWorkspace ||
            !binding.runtimeCwd ||
            !['docker', 'local'].includes(binding.type) ||
            (input.feature?.targetBranch &&
              input.feature.targetBranch !== binding.featureWorkspace.baseBranch)
          )
            throw new EnvironmentConfigurationError(
              'This feature has a different or legacy managed workspace. Start a new feature; no automatic branch/environment migration was performed.'
            );
          const environment =
            binding.type === 'docker'
              ? new DockerExecutionEnvironment(this.docker, binding.docker!, binding.runtimeCwd)
              : await LocalExecutionEnvironment.create(binding.runtimeCwd);
          await verifyManagedFeatureWorkspace(
            environment,
            projectPath,
            binding.featureWorkspace,
            input.signal ?? new AbortController().signal
          );
        }
        if (binding.type === 'ssh') {
          if (!binding.ssh || !binding.runtimeCwd || binding.ssh.projectPath !== projectPath)
            throw new EnvironmentConfigurationError(
              'Pinned SSH descriptor is missing or does not match the project.'
            );
          await this.ssh.verify(binding.ssh, input.signal);
          if (
            input.sshFeature &&
            (!binding.sshWorkspace ||
              (input.sshFeature.targetBranch &&
                input.sshFeature.targetBranch !== binding.sshWorkspace.baseBranch))
          )
            throw new EnvironmentConfigurationError(
              'This feature has a different or legacy SSH workspace. Start a new feature; no branch migration was performed.'
            );
          if (binding.sshWorkspace)
            await this.ssh.verifyWorkspace(
              binding.ssh,
              binding.runtimeCwd,
              binding.sshWorkspace,
              input.signal
            );
        }
        if (binding.serverIdentity !== this.serverIdentity) {
          if (binding.type === 'legacy')
            throw new EnvironmentConfigurationError(
              'Legacy binding belongs to another server identity. Start a new session/task; no automatic migration was performed.'
            );
          // Recreated containers change hostname. Reauthorization on the new identity is explicit;
          // it renews authority, but does not change Local/cwd or replay unfinished commands.
          binding.serverIdentity = this.serverIdentity;
          await atomicWriteJson(file, { binding }, { mode: 0o600 });
        }
        return {
          binding: JSON.parse(JSON.stringify(binding)),
          legacySettings: stored.legacySettings,
        };
      }
      if (input.existingId)
        throw new EnvironmentConfigurationError(
          'Pinned workspace binding disappeared. No new environment was prepared.'
        );
      const state = await this.configuration(projectPath);
      if (!['local', 'auto', 'docker', 'ssh'].includes(state.resolved.type))
        throw new EnvironmentConfigurationError(
          `Selected environment ${state.resolved.type} is not available for Direct execution yet. No Local fallback was performed.`
        );
      let docker: import('@automaker/types').DockerProjectBinding | undefined;
      let ssh: import('@automaker/types').SSHProjectBinding | undefined;
      let runtimeCwd: string | undefined;
      let sshWorkspace: import('@automaker/types').SSHFeatureWorkspace | undefined;
      let fallbackReason: ExecutionEnvironmentBinding['fallbackReason'];
      if (state.resolved.type === 'docker' || state.resolved.type === 'auto') {
        const context =
          state.resolved.profile?.type === 'docker' ? state.resolved.profile.context : undefined;
        try {
          // Only connection/mapping preflight errors can authorize Auto fallback. Build/create/
          // storage failures (and all already pinned Docker runs) never downgrade or replay.
          await this.docker.preflight(projectPath, cwd, context, input.signal);
        } catch (error) {
          if (
            state.resolved.type !== 'auto' ||
            !(error instanceof DockerPreflightError) ||
            input.signal?.aborted
          )
            throw error;
          await this.requireConsent(projectPath, true);
          fallbackReason = 'docker-preflight-unavailable';
        }
        if (!fallbackReason)
          docker = await this.docker.prepare(projectPath, cwd, context, input.signal);
      } else if (state.resolved.type === 'ssh' && state.resolved.profile?.type === 'ssh') {
        const relative = path.relative(projectPath, cwd);
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
          throw new EnvironmentConfigurationError(
            'SSH working directory must be inside the project control-plane directory.'
          );
        const result = await this.ssh.bind(
          state.resolved.profile,
          projectPath,
          input.key ?? id,
          relative,
          input.signal,
          input.sshFeature
        );
        ssh = result.binding;
        runtimeCwd = result.runtimeCwd;
        sshWorkspace = result.workspace;
      } else if (state.explicit) await this.requireConsent(projectPath);
      const binding: ExecutionEnvironmentBinding = {
        version: 1,
        id,
        type: ssh ? 'ssh' : docker ? 'docker' : state.explicit ? 'local' : 'legacy',
        projectPath,
        cwd,
        serverIdentity: this.serverIdentity,
        createdAt: new Date().toISOString(),
        selection: state.resolved.selection,
        source: state.resolved.source,
        ...(docker && { docker }),
        ...(ssh && { ssh }),
        ...(runtimeCwd && { runtimeCwd }),
        ...(sshWorkspace && { sshWorkspace }),
        ...(fallbackReason && { fallbackReason }),
      };
      if (input.feature && (docker || fallbackReason)) {
        if (cwd !== projectPath)
          throw new EnvironmentConfigurationError(
            'Managed features require the project control-plane root. No host worktree was prepared.'
          );
        binding.featurePreparation = input.feature;
        await fs.mkdir(path.dirname(file), { recursive: true });
        // Pin the environment before the first feature Git effect; a crash/settings change cannot retarget it.
        await atomicWriteJson(file, { binding }, { mode: 0o600 });
        const environment = docker
          ? new DockerExecutionEnvironment(this.docker, docker, projectPath)
          : await LocalExecutionEnvironment.create(projectPath);
        const prepared = await prepareManagedFeatureWorkspace({
          environment,
          directory: this.directory,
          id,
          root: projectPath,
          targetBranch: input.feature.targetBranch,
          signal: input.signal ?? new AbortController().signal,
        });
        binding.runtimeCwd = prepared.runtimeCwd;
        binding.featureWorkspace = prepared.workspace;
        delete binding.featurePreparation;
      }
      const value = {
        binding,
        ...(binding.type === 'legacy' && {
          legacySettings: JSON.parse(JSON.stringify(input.legacySettings)) as DirectAgentSettings,
        }),
      };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await atomicWriteJson(file, value, { mode: 0o600 });
      return value;
    });
  }
  private async requireConsent(projectPath: string, fallback = false) {
    const consent = await this.consent(projectPath);
    if (!(fallback ? consent.autoFallbackConfirmed : consent.confirmed))
      throw new EnvironmentConfigurationError(
        `${fallback ? 'Auto Local fallback' : 'Local execution'} requires explicit server-side risk confirmation in Execution Environment settings. Existing sandbox-warning preferences do not grant access.`
      );
  }
}
