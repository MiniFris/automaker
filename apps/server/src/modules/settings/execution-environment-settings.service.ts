import { Inject, Injectable } from '@nestjs/common';
import path from 'node:path';
import fs from 'node:fs/promises';

import { SettingsService } from '../../services/settings-service.js';
import { EnvironmentBindingStore } from '../../services/execution-environment/bindings.js';
import { ManagedDocker } from '../../services/execution-environment/docker.js';
import { ManagedSSH } from '../../services/execution-environment/ssh.js';
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
  private writes: Promise<unknown> = Promise.resolve();

  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {
    this.bindings = new EnvironmentBindingStore(settings);
    this.docker = new ManagedDocker(settings);
    this.ssh = new ManagedSSH(settings);
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
