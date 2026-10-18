import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { EnvironmentBindingStore } from '../../services/execution-environment/bindings.js';
import { ManagedDocker } from '../../services/execution-environment/docker.js';
import { ManagedSSH, type SSHProjectSource } from '../../services/execution-environment/ssh.js';
import { featureRunKey } from '../../services/execution-environment/ssh-feature.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { ProviderSetupService } from '../../services/execution-environment/provider-setup.js';
import type { RemoteSdkProvider } from '@automaker/types';
import type { SettingsService } from '../../services/settings-service.js';
import { validatePathParams } from '../../middleware/validate-paths.js';
import {
  defaultEnvironmentSettings,
  EnvironmentConfigurationError,
  parseEnvironmentSettings,
  parseEnvironmentSelection,
  resolveEnvironment,
} from '../../services/execution-environment/config.js';
import {
  diagnoseDockerConnection,
  type DockerDiagnosticRunner,
} from '../../services/execution-environment/docker-diagnostics.js';

/** Inherits /api/settings authentication. Mutations require the separate explicit prepare action. */
export function createExecutionEnvironmentSettingsRoutes(
  settings: SettingsService,
  runner?: DockerDiagnosticRunner,
  docker = new ManagedDocker(settings),
  ssh = new ManagedSSH(settings)
): Router {
  const router = Router();
  const bindings = new EnvironmentBindingStore(settings);
  const providers = new ProviderSetupService(settings, docker, ssh);
  let writes = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>) => {
    const next = writes.then(work);
    writes = next.then(
      () => {},
      () => {}
    );
    return next;
  };
  async function dto(projectPath?: string) {
    const global = await settings.getGlobalSettings();
    const config = parseEnvironmentSettings(
      global.executionEnvironment ?? defaultEnvironmentSettings()
    );
    const project = projectPath ? await settings.getProjectSettings(projectPath) : undefined;
    const override =
      project?.executionEnvironment == null
        ? null
        : parseEnvironmentSelection(project.executionEnvironment);
    const localConsent = await bindings.consent(projectPath);
    const resolved = resolveEnvironment(config, override);
    return {
      settings: config,
      projectOverride: override,
      resolved: {
        ...resolved,
        runtimeIntegrated:
          (resolved.type === 'local' && !localConsent.legacy && localConsent.confirmed) ||
          resolved.type === 'docker' ||
          resolved.type === 'auto' ||
          resolved.type === 'ssh',
      },
      localConsent,
      ...(resolved.profile?.type === 'ssh' && {
        ssh: await ssh.status(resolved.profile, projectPath),
      }),
    };
  }
  const handle =
    (work: (body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const controller = new AbortController();
      const close = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.on('close', close);
      try {
        res.json({ success: true, ...((await work(req.body ?? {}, controller.signal)) as object) });
      } catch (error) {
        const known =
          error instanceof EnvironmentConfigurationError ||
          error instanceof ExecutionEnvironmentError;
        res.status(known ? 400 : 500).json({
          success: false,
          error: known
            ? error.message
            : 'Execution environment configuration could not be loaded or saved.',
        });
      } finally {
        res.off('close', close);
      }
    };
  function fields(body: Record<string, unknown>, allowed: string[]) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.includes(key))
    )
      throw new EnvironmentConfigurationError('Unknown environment settings field.');
  }
  function projectPath(body: Record<string, unknown>, required = false): string | undefined {
    if (body.projectPath === undefined && !required) return undefined;
    if (
      typeof body.projectPath !== 'string' ||
      !path.isAbsolute(body.projectPath) ||
      body.projectPath.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(body.projectPath)
    )
      throw new EnvironmentConfigurationError('projectPath is required.');
    return body.projectPath;
  }
  async function sshProfile(body: Record<string, unknown>) {
    if (typeof body.profileId !== 'string')
      throw new EnvironmentConfigurationError('Choose a saved SSH profile.');
    const config = await bindings.configuration();
    const profile = config.config.profiles.find((item) => item.id === body.profileId);
    if (profile?.type !== 'ssh')
      throw new EnvironmentConfigurationError('Choose a saved SSH profile.');
    return profile;
  }
  for (const operation of ['inspect', 'install', 'key'] as const)
    router.post(
      `/providers/${operation}`,
      validatePathParams('projectPath'),
      handle(async (body, signal) => {
        fields(
          body,
          operation === 'inspect'
            ? ['projectPath', 'provider']
            : operation === 'install'
              ? ['projectPath', 'provider', 'targetId', 'accepted']
              : ['projectPath', 'provider', 'targetId', 'accepted', 'apiKey', 'clear']
        );
        if (!['claude', 'codex', 'copilot'].includes(body.provider as string))
          throw new EnvironmentConfigurationError('Choose Claude, Codex or Copilot.');
        if (
          operation !== 'inspect' &&
          (body.accepted !== true ||
            typeof body.targetId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(body.targetId))
        )
          throw new EnvironmentConfigurationError(
            'Inspect and explicitly accept this saved provider target first.'
          );
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
        )
          throw new EnvironmentConfigurationError('Provide a target API key/token, or clear:true.');
        return {
          status: await providers.run(
            projectPath(body, true)!,
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
      })
    );
  router.post(
    '/feature/inspect',
    validatePathParams('projectPath'),
    handle(async (body) => {
      fields(body, ['projectPath', 'featureId']);
      const target = projectPath(body, true)!;
      if (
        typeof body.featureId !== 'string' ||
        !body.featureId ||
        body.featureId.length > 200 ||
        /[\x00-\x1f\x7f]/.test(body.featureId)
      )
        throw new EnvironmentConfigurationError('featureId is required.');
      const binding = await bindings.peek(target, featureRunKey(target, body.featureId));
      return {
        binding: binding ?? null,
        selectedType: (await bindings.configuration(target)).resolved.type,
      };
    })
  );
  router.post(
    '/ssh/scan',
    handle(async (body, signal) => {
      fields(body, ['profileId']);
      return { hostKey: await ssh.state.scan(await sshProfile(body), signal) };
    })
  );
  router.post(
    '/ssh/trust',
    handle(async (body, signal) => {
      fields(body, ['profileId', 'fingerprint', 'accepted', 'replace']);
      if (
        body.accepted !== true ||
        typeof body.fingerprint !== 'string' ||
        !/^SHA256:[A-Za-z0-9+/]{43}$/.test(body.fingerprint) ||
        (body.replace !== undefined && typeof body.replace !== 'boolean')
      )
        throw new EnvironmentConfigurationError(
          'Confirm the exact SHA256 fingerprint after independent verification.'
        );
      const profile = await sshProfile(body);
      await ssh.state.confirm(profile, body.fingerprint, body.replace === true, signal);
      return dto();
    })
  );
  router.post(
    '/ssh/key',
    handle(async (body) => {
      fields(body, ['profileId', 'privateKey', 'passphrase', 'clear']);
      const profile = await sshProfile(body);
      if (!profile.credentialId)
        throw new EnvironmentConfigurationError(
          'Save a credential ID on this SSH profile first, or use the server ssh-agent.'
        );
      if (body.clear === true && body.privateKey === undefined && body.passphrase === undefined)
        await ssh.state.removeKey(profile.credentialId);
      else {
        if (
          body.clear !== undefined ||
          typeof body.privateKey !== 'string' ||
          (body.passphrase !== undefined && typeof body.passphrase !== 'string')
        )
          throw new EnvironmentConfigurationError(
            'Provide a private key and optional passphrase, or clear:true.'
          );
        await ssh.state.saveKey(
          profile.credentialId,
          body.privateKey,
          body.passphrase as string | undefined
        );
      }
      return dto();
    })
  );
  router.post(
    '/ssh/check',
    validatePathParams('projectPath?'),
    handle(async (body, signal) => {
      fields(body, ['profileId', 'projectPath']);
      return { diagnostic: await ssh.diagnose(await sshProfile(body), projectPath(body), signal) };
    })
  );
  router.post(
    '/ssh/prepare',
    handle(async (body, signal) => {
      fields(body, ['profileId', 'accepted']);
      if (body.accepted !== true)
        throw new EnvironmentConfigurationError(
          'Explicit acceptance of remote worker installation/full SSH-user access is required.'
        );
      const profile = await sshProfile(body);
      await ssh.prepareWorker(profile, signal);
      return dto();
    })
  );
  router.post(
    '/ssh/project',
    validatePathParams('projectPath'),
    handle(async (body, signal) => {
      fields(body, ['profileId', 'projectPath', 'accepted', 'source']);
      if (body.accepted !== true)
        throw new EnvironmentConfigurationError(
          'Explicit acceptance of the authoritative remote checkout and initial transfer is required.'
        );
      const target = projectPath(body, true)!;
      const profile = await sshProfile(body);
      const state = await bindings.configuration(target);
      if (state.resolved.profile?.id !== profile.id)
        throw new EnvironmentConfigurationError(
          'Save this SSH profile as the project selection before preparing its checkout.'
        );
      const source = body.source as Record<string, unknown>;
      fields(source, ['method', 'repositoryUrl', 'remotePath']);
      if (
        !source ||
        !['clone', 'import', 'existing'].includes(source.method as string) ||
        (source.method === 'clone'
          ? typeof source.repositoryUrl !== 'string' || source.remotePath !== undefined
          : source.repositoryUrl !== undefined) ||
        (source.method === 'existing'
          ? typeof source.remotePath !== 'string'
          : source.remotePath !== undefined)
      )
        throw new EnvironmentConfigurationError(
          'Choose clone with a repository URL, import, or an existing remote path.'
        );
      await ssh.prepareProject(profile, target, source as SSHProjectSource, signal);
      return dto(target);
    })
  );
  router.post(
    '/ssh/recover',
    validatePathParams('projectPath'),
    handle(async (body, signal) => {
      fields(body, ['profileId', 'projectPath', 'accepted']);
      if (body.accepted !== true)
        throw new EnvironmentConfigurationError(
          'Inspect remote effects and explicitly acknowledge recovery; commands are not replayed.'
        );
      const profile = await sshProfile(body),
        target = await fs.realpath(projectPath(body, true)!);
      const trust = await ssh.state.trust(profile);
      const binding = trust
        ? await ssh.state.project(profile, trust.fingerprint, target)
        : undefined;
      if (!binding)
        throw new EnvironmentConfigurationError(
          'No prepared SSH checkout exists for this profile/project.'
        );
      await ssh.recover(binding, signal);
      return dto(target);
    })
  );
  for (const operation of ['confirm', 'revoke'] as const) {
    router.post(
      `/auto/${operation}`,
      validatePathParams('projectPath?'),
      handle(async (body) => {
        fields(
          body,
          operation === 'confirm' ? ['projectPath', 'accepted', 'warningVersion'] : ['projectPath']
        );
        if (operation === 'confirm' && (body.accepted !== true || body.warningVersion !== 1))
          throw new EnvironmentConfigurationError(
            'Explicit acceptance of Auto Local fallback warning version 1 is required.'
          );
        const target = projectPath(body);
        return serialize(async () => {
          await bindings[operation](target, true);
          return dto(target);
        });
      })
    );
  }
  router.post(
    '/docker/prepare',
    validatePathParams('projectPath?'),
    handle(async (body, signal) => {
      fields(body, ['projectPath', 'profileId', 'accepted']);
      if (body.accepted !== true)
        throw new EnvironmentConfigurationError(
          'Explicit acceptance is required: preparation may download/build an image and create containers.'
        );
      const target = projectPath(body);
      let context: string | undefined;
      const state = await dto(target);
      if (target) {
        if (!['docker', 'auto'].includes(state.resolved.type))
          throw new EnvironmentConfigurationError(
            'Save Docker or Auto for this project before preparing its container.'
          );
        if (body.profileId !== undefined && state.resolved.profile?.id !== body.profileId)
          throw new EnvironmentConfigurationError(
            'The requested profile does not match the project selection.'
          );
        context =
          state.resolved.profile?.type === 'docker' ? state.resolved.profile.context : undefined;
      } else if (body.profileId !== undefined) {
        const profile = state.settings.profiles.find((item) => item.id === body.profileId);
        if (profile?.type !== 'docker')
          throw new EnvironmentConfigurationError('Choose a saved Docker profile.');
        context = profile.context;
      }
      const canonical = target ? await fs.realpath(target) : undefined;
      // Unlike /docker/check, this is deliberately mutating and never runs on page load.
      return { preparation: await docker.probe(context, canonical, signal) };
    })
  );
  router.post(
    '/local/confirm',
    validatePathParams('projectPath?'),
    handle(async (body) => {
      fields(body, ['projectPath', 'accepted', 'warningVersion']);
      if (body.accepted !== true || body.warningVersion !== 1)
        throw new EnvironmentConfigurationError(
          'Explicit acceptance of Local execution warning version 1 is required.'
        );
      const target = projectPath(body);
      return serialize(async () => {
        await bindings.confirm(target);
        return dto(target);
      });
    })
  );
  router.post(
    '/local/revoke',
    validatePathParams('projectPath?'),
    handle(async (body) => {
      fields(body, ['projectPath']);
      const target = projectPath(body);
      return serialize(async () => {
        await bindings.revoke(target);
        return dto(target);
      });
    })
  );
  router.post(
    '/inspect',
    validatePathParams('projectPath?'),
    handle(async (body) => {
      fields(body, ['projectPath']);
      return dto(projectPath(body));
    })
  );
  router.put(
    '/global',
    handle(async (body) => {
      fields(body, ['settings']);
      const config = parseEnvironmentSettings(body.settings);
      return serialize(async () => {
        await settings.updateGlobalSettings({ executionEnvironment: config });
        return dto();
      });
    })
  );
  router.put(
    '/project',
    validatePathParams('projectPath'),
    handle(async (body) => {
      fields(body, ['projectPath', 'selection']);
      const target = projectPath(body, true)!;
      if (!Object.hasOwn(body, 'selection'))
        throw new EnvironmentConfigurationError('selection is required; use null to inherit.');
      const selection = body.selection === null ? null : parseEnvironmentSelection(body.selection);
      return serialize(async () => {
        const state = await dto();
        if (
          selection?.mode === 'profile' &&
          !state.settings.profiles.some((profile) => profile.id === selection.profileId)
        )
          throw new EnvironmentConfigurationError('Selected environment profile does not exist.');
        await settings.updateProjectSettings(target, { executionEnvironment: selection });
        return dto(target);
      });
    })
  );
  router.post(
    '/docker/check',
    handle(async (body, signal) => {
      fields(body, ['profileId']);
      let context: string | undefined;
      if (body.profileId !== undefined) {
        if (typeof body.profileId !== 'string')
          throw new EnvironmentConfigurationError('Invalid profile ID.');
        const state = await dto();
        const profile = state.settings.profiles.find((item) => item.id === body.profileId);
        if (profile?.type !== 'docker')
          throw new EnvironmentConfigurationError('Choose a saved Docker profile.');
        context = profile.context;
      }
      return { diagnostic: await diagnoseDockerConnection(context, signal, runner) };
    })
  );
  return router;
}
