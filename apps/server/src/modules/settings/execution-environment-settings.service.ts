import { Inject, Injectable } from '@nestjs/common';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
import path from 'node:path';
import fs from 'node:fs/promises';

import { SettingsService } from '../../services/settings-service.js';
import { EnvironmentBindingStore } from '../../services/execution-environment/bindings.js';
import { ManagedDocker } from '../../services/execution-environment/docker.js';
import { ManagedSSH, type SSHProjectSource } from '../../services/execution-environment/ssh.js';
import { ProviderSetupService } from '../../services/execution-environment/provider-setup.js';
import type { RemoteSdkProvider } from '@automaker/types';
import { featureRunKey } from '../../services/execution-environment/ssh-feature.js';
import {
  defaultEnvironmentSettings,
  EnvironmentConfigurationError,
  parseEnvironmentSelection,
  parseEnvironmentSettings,
  resolveEnvironment,
} from '../../services/execution-environment/config.js';
import {
  diagnoseDockerConnection,
  type DockerDiagnosticRunner,
} from '../../services/execution-environment/docker-diagnostics.js';

@Injectable()
export class ExecutionEnvironmentSettingsService {
  private readonly bindings: EnvironmentBindingStore;
  private readonly docker: ManagedDocker;
  private readonly ssh: ManagedSSH;
  private readonly providers: ProviderSetupService;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>
  ) {
    this.bindings = new EnvironmentBindingStore(
      settings,
      undefined,
      undefined,
      captureNativeLocalEnvironment(environment)
    );
    this.docker = new ManagedDocker(settings);
    this.ssh = new ManagedSSH(settings);
    this.providers = new ProviderSetupService(settings, this.docker, this.ssh);
  }

  async inspect(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.fields(body, ['projectPath']);
    return { success: true, ...(await this.dto(this.projectPath(body))) };
  }

  async inspectFeature(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.fields(body, ['projectPath', 'featureId']);
    const target = this.projectPath(body, true)!;
    if (
      typeof body.featureId !== 'string' ||
      !body.featureId ||
      body.featureId.length > 200 ||
      /[\x00-\x1f\x7f]/.test(body.featureId)
    ) {
      throw new EnvironmentConfigurationError('featureId is required.');
    }
    const binding = await this.bindings.peek(target, featureRunKey(target, body.featureId));
    return {
      success: true,
      binding: binding ?? null,
      selectedType: (await this.bindings.configuration(target)).resolved.type,
    };
  }

  async updateGlobal(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.fields(body, ['settings']);
    const config = parseEnvironmentSettings(body.settings);
    return this.serialize(async () => {
      await this.settings.updateGlobalSettings({ executionEnvironment: config });
      return { success: true, ...(await this.dto()) };
    });
  }

  async updateProject(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.fields(body, ['projectPath', 'selection']);
    const target = this.projectPath(body, true)!;
    if (!Object.hasOwn(body, 'selection')) {
      throw new EnvironmentConfigurationError('selection is required; use null to inherit.');
    }
    const selection = body.selection === null ? null : parseEnvironmentSelection(body.selection);
    return this.serialize(async () => {
      const state = await this.dto();
      if (
        selection?.mode === 'profile' &&
        !state.settings.profiles.some((profile) => profile.id === selection.profileId)
      ) {
        throw new EnvironmentConfigurationError('Selected environment profile does not exist.');
      }
      await this.settings.updateProjectSettings(target, { executionEnvironment: selection });
      return { success: true, ...(await this.dto(target)) };
    });
  }

  async updateConsent(
    kind: 'local' | 'auto',
    operation: 'confirm' | 'revoke',
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    this.fields(
      body,
      operation === 'confirm' ? ['projectPath', 'accepted', 'warningVersion'] : ['projectPath']
    );
    if (operation === 'confirm' && (body.accepted !== true || body.warningVersion !== 1)) {
      throw new EnvironmentConfigurationError(
        `Explicit acceptance of ${kind === 'auto' ? 'Auto Local fallback' : 'Local execution'} warning version 1 is required.`
      );
    }
    const target = this.projectPath(body);
    return this.serialize(async () => {
      if (kind === 'auto') await this.bindings[operation](target, true);
      else await this.bindings[operation](target);
      return { success: true, ...(await this.dto(target)) };
    });
  }

  async checkDocker(
    body: Record<string, unknown>,
    signal: AbortSignal,
    runner?: DockerDiagnosticRunner
  ): Promise<Record<string, unknown>> {
    this.fields(body, ['profileId']);
    let context: string | undefined;
    if (body.profileId !== undefined) {
      if (typeof body.profileId !== 'string') {
        throw new EnvironmentConfigurationError('Invalid profile ID.');
      }
      const state = await this.dto();
      const profile = state.settings.profiles.find((item) => item.id === body.profileId);
      if (profile?.type !== 'docker') {
        throw new EnvironmentConfigurationError('Choose a saved Docker profile.');
      }
      context = profile.context;
    }
    return { success: true, diagnostic: await diagnoseDockerConnection(context, signal, runner) };
  }

  async prepareDocker(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    this.fields(body, ['projectPath', 'profileId', 'accepted']);
    if (body.accepted !== true) {
      throw new EnvironmentConfigurationError(
        'Explicit acceptance is required: preparation may download/build an image and create containers.'
      );
    }
    const target = this.projectPath(body);
    let context: string | undefined;
    const state = await this.dto(target);
    if (target) {
      if (!['docker', 'auto'].includes(state.resolved.type)) {
        throw new EnvironmentConfigurationError(
          'Save Docker or Auto for this project before preparing its container.'
        );
      }
      if (body.profileId !== undefined && state.resolved.profile?.id !== body.profileId) {
        throw new EnvironmentConfigurationError(
          'The requested profile does not match the project selection.'
        );
      }
      context =
        state.resolved.profile?.type === 'docker' ? state.resolved.profile.context : undefined;
    } else if (body.profileId !== undefined) {
      const profile = state.settings.profiles.find((item) => item.id === body.profileId);
      if (profile?.type !== 'docker') {
        throw new EnvironmentConfigurationError('Choose a saved Docker profile.');
      }
      context = profile.context;
    }
    const canonical = target ? await fs.realpath(target) : undefined;
    return { success: true, preparation: await this.docker.probe(context, canonical, signal) };
  }

  async providerOperation(
    operation: 'inspect' | 'install' | 'key',
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    this.fields(
      body,
      operation === 'inspect'
        ? ['projectPath', 'provider']
        : operation === 'install'
          ? ['projectPath', 'provider', 'targetId', 'accepted']
          : ['projectPath', 'provider', 'targetId', 'accepted', 'apiKey', 'clear']
    );
    if (!['claude', 'codex', 'copilot'].includes(body.provider as string)) {
      throw new EnvironmentConfigurationError('Choose Claude, Codex or Copilot.');
    }
    if (
      operation !== 'inspect' &&
      (body.accepted !== true ||
        typeof body.targetId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.targetId))
    ) {
      throw new EnvironmentConfigurationError(
        'Inspect and explicitly accept this saved provider target first.'
      );
    }
    if (
      operation === 'key' &&
      !(body.clear === true && body.apiKey === undefined) &&
      !(
        body.clear === undefined &&
        typeof body.apiKey === 'string' &&
        body.apiKey.length >= 8 &&
        body.apiKey.length <= 16384 &&
        !/[\x00-\x20\x7f]/.test(body.apiKey)
      )
    ) {
      throw new EnvironmentConfigurationError('Provide a target API key/token, or clear:true.');
    }
    return {
      success: true,
      status: await this.providers.run(
        this.projectPath(body, true)!,
        body.provider as RemoteSdkProvider,
        operation,
        signal,
        operation === 'inspect'
          ? undefined
          : {
              targetId: body.targetId as string,
              apiKey: body.apiKey as string | undefined,
              clear: body.clear === true,
            }
      ),
    };
  }

  async scanSSH(body: Record<string, unknown>, signal: AbortSignal) {
    this.fields(body, ['profileId']);
    return {
      success: true,
      hostKey: await this.ssh.state.scan(await this.sshProfile(body), signal),
    };
  }

  async trustSSH(body: Record<string, unknown>, signal: AbortSignal) {
    this.fields(body, ['profileId', 'fingerprint', 'accepted', 'replace']);
    if (
      body.accepted !== true ||
      typeof body.fingerprint !== 'string' ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(body.fingerprint) ||
      (body.replace !== undefined && typeof body.replace !== 'boolean')
    ) {
      throw new EnvironmentConfigurationError(
        'Confirm the exact SHA256 fingerprint after independent verification.'
      );
    }
    const profile = await this.sshProfile(body);
    await this.ssh.state.confirm(profile, body.fingerprint, body.replace === true, signal);
    return { success: true, ...(await this.dto()) };
  }

  async updateSSHKey(body: Record<string, unknown>) {
    this.fields(body, ['profileId', 'privateKey', 'passphrase', 'clear']);
    const profile = await this.sshProfile(body);
    if (!profile.credentialId) {
      throw new EnvironmentConfigurationError(
        'Save a credential ID on this SSH profile first, or use the server ssh-agent.'
      );
    }
    if (body.clear === true && body.privateKey === undefined && body.passphrase === undefined) {
      await this.ssh.state.removeKey(profile.credentialId);
    } else {
      if (
        body.clear !== undefined ||
        typeof body.privateKey !== 'string' ||
        (body.passphrase !== undefined && typeof body.passphrase !== 'string')
      ) {
        throw new EnvironmentConfigurationError(
          'Provide a private key and optional passphrase, or clear:true.'
        );
      }
      await this.ssh.state.saveKey(
        profile.credentialId,
        body.privateKey,
        body.passphrase as string | undefined
      );
    }
    return { success: true, ...(await this.dto()) };
  }

  async checkSSH(body: Record<string, unknown>, signal: AbortSignal) {
    this.fields(body, ['profileId', 'projectPath']);
    return {
      success: true,
      diagnostic: await this.ssh.diagnose(
        await this.sshProfile(body),
        this.projectPath(body),
        signal
      ),
    };
  }

  async prepareSSH(body: Record<string, unknown>, signal: AbortSignal) {
    this.fields(body, ['profileId', 'accepted']);
    if (body.accepted !== true) {
      throw new EnvironmentConfigurationError(
        'Explicit acceptance of remote worker installation/full SSH-user access is required.'
      );
    }
    const profile = await this.sshProfile(body);
    await this.ssh.prepareWorker(profile, signal);
    return { success: true, ...(await this.dto()) };
  }

  async prepareSSHProject(body: Record<string, unknown>, signal: AbortSignal) {
    this.fields(body, ['profileId', 'projectPath', 'accepted', 'source']);
    if (body.accepted !== true) {
      throw new EnvironmentConfigurationError(
        'Explicit acceptance of the authoritative remote checkout and initial transfer is required.'
      );
    }
    const target = this.projectPath(body, true)!;
    const profile = await this.sshProfile(body);
    const state = await this.bindings.configuration(target);
    if (state.resolved.profile?.id !== profile.id) {
      throw new EnvironmentConfigurationError(
        'Save this SSH profile as the project selection before preparing its checkout.'
      );
    }
    const source = body.source as Record<string, unknown>;
    this.fields(source, ['method', 'repositoryUrl', 'remotePath']);
    if (
      !source ||
      !['clone', 'import', 'existing'].includes(source.method as string) ||
      (source.method === 'clone'
        ? typeof source.repositoryUrl !== 'string' || source.remotePath !== undefined
        : source.repositoryUrl !== undefined) ||
      (source.method === 'existing'
        ? typeof source.remotePath !== 'string'
        : source.remotePath !== undefined)
    ) {
      throw new EnvironmentConfigurationError(
        'Choose clone with a repository URL, import, or an existing remote path.'
      );
    }
    await this.ssh.prepareProject(profile, target, source as SSHProjectSource, signal);
    return { success: true, ...(await this.dto(target)) };
  }

  async recoverSSH(body: Record<string, unknown>, signal: AbortSignal) {
    this.fields(body, ['profileId', 'projectPath', 'accepted']);
    if (body.accepted !== true) {
      throw new EnvironmentConfigurationError(
        'Inspect remote effects and explicitly acknowledge recovery; commands are not replayed.'
      );
    }
    const profile = await this.sshProfile(body);
    const target = await fs.realpath(this.projectPath(body, true)!);
    const trust = await this.ssh.state.trust(profile);
    const binding = trust
      ? await this.ssh.state.project(profile, trust.fingerprint, target)
      : undefined;
    if (!binding) {
      throw new EnvironmentConfigurationError(
        'No prepared SSH checkout exists for this profile/project.'
      );
    }
    await this.ssh.recover(binding, signal);
    return { success: true, ...(await this.dto(target)) };
  }

  private async dto(projectPath?: string) {
    const global = await this.settings.getGlobalSettings();
    const settings = parseEnvironmentSettings(
      global.executionEnvironment ?? defaultEnvironmentSettings()
    );
    const project = projectPath ? await this.settings.getProjectSettings(projectPath) : undefined;
    const projectOverride =
      project?.executionEnvironment == null
        ? null
        : parseEnvironmentSelection(project.executionEnvironment);
    const localConsent = await this.bindings.consent(projectPath);
    const resolved = resolveEnvironment(settings, projectOverride);
    return {
      settings,
      projectOverride,
      resolved: {
        ...resolved,
        runtimeIntegrated:
          (resolved.type === 'local' && !localConsent.legacy && localConsent.confirmed) ||
          ['docker', 'auto', 'ssh'].includes(resolved.type),
      },
      localConsent,
      ...(resolved.profile?.type === 'ssh' && {
        ssh: await this.ssh.status(resolved.profile, projectPath),
      }),
    };
  }

  private fields(body: Record<string, unknown>, allowed: string[]): void {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))
    ) {
      throw new EnvironmentConfigurationError('Unknown environment settings field.');
    }
  }

  private async sshProfile(body: Record<string, unknown>) {
    if (typeof body.profileId !== 'string') {
      throw new EnvironmentConfigurationError('Choose a saved SSH profile.');
    }
    const config = await this.bindings.configuration();
    const profile = config.config.profiles.find((item) => item.id === body.profileId);
    if (profile?.type !== 'ssh') {
      throw new EnvironmentConfigurationError('Choose a saved SSH profile.');
    }
    return profile;
  }

  private projectPath(body: Record<string, unknown>, required = false): string | undefined {
    if (body.projectPath === undefined && !required) return undefined;
    if (
      typeof body.projectPath !== 'string' ||
      !path.isAbsolute(body.projectPath) ||
      body.projectPath.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(body.projectPath)
    ) {
      throw new EnvironmentConfigurationError('projectPath is required.');
    }
    return body.projectPath;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work);
    this.writes = next.catch(() => {});
    return next;
  }
}
