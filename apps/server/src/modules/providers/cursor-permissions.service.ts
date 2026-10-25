import {
  CursorPermissionsScopeSchema,
  CursorPermissionProfileIdSchema,
} from '@automaker/contracts/domains/setup-query';
import { Inject, Injectable } from '@nestjs/common';
import {
  CursorCustomPermissionsRequestSchema,
  CursorDeletePermissionsRequestSchema,
  CursorProfileRequestSchema,
  type CursorPermissionsTarget,
  type CursorProfileRequest,
  type CursorCustomPermissionsRequest,
  type CursorDeletePermissionsRequest,
} from '@automaker/contracts';
import { CURSOR_PERMISSION_PROFILES, type CursorCliPermissions } from '@automaker/types';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { CursorPermissionsRepository } from './cursor-permissions.repository.js';

@Injectable()
export class CursorPermissionsService {
  private closing: Promise<void> | undefined;
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(
    @Inject(CursorPermissionsRepository) private readonly repository: CursorPermissionsRepository,
    @Inject(ProviderConnectionRepository) private readonly connections: ProviderConnectionRepository
  ) {}
  private accepting() {
    if (this.closing)
      throw new UnavailableDomainError('Cursor permissions setup is shutting down.');
  }
  private async resolve(
    scope: 'global' | 'project',
    projectPath?: string,
    allowMissingProject = false
  ): Promise<CursorPermissionsTarget> {
    const { instanceId, workingDirectory } = this.connections.target('cursor');
    const location = await this.repository.location(scope, projectPath, allowMissingProject);
    return {
      kind: 'host-cursor-permissions',
      provider: 'cursor',
      instanceId,
      workingDirectory,
      ...location,
    };
  }
  async target(scope: unknown, projectPath?: string) {
    this.accepting();
    const parsed = CursorPermissionsScopeSchema.safeParse(scope);
    if (!parsed.success) throw new ValidationDomainError('Scope must be global or project.');
    if (scope === 'global' && projectPath !== undefined)
      throw new ValidationDomainError('Global scope must not include projectPath.');
    return {
      success: true as const,
      protocolVersion: 1 as const,
      target: await this.resolve(parsed.data, projectPath),
    };
  }
  private async confirmed(target: CursorPermissionsTarget): Promise<CursorPermissionsTarget> {
    const current = await this.resolve(
      target.scope,
      target.scope === 'project' ? target.projectPath : undefined
    );
    if (
      current.kind !== target.kind ||
      current.instanceId !== target.instanceId ||
      current.workingDirectory !== target.workingDirectory ||
      current.configPath !== target.configPath ||
      current.provider !== target.provider ||
      current.scope !== target.scope ||
      (current.scope === 'project' &&
        target.scope === 'project' &&
        current.projectPath !== target.projectPath)
    )
      throw new ConflictDomainError(
        'Cursor permissions target changed. Inspect and confirm it again.'
      );
    return current;
  }
  private async mutate<T>(
    target: CursorPermissionsTarget,
    action: (target: CursorPermissionsTarget) => Promise<T>
  ) {
    this.accepting();
    // Queue before awaiting target IO; preserve accepted request ordering for the same file.
    const previous = this.queues.get(target.configPath) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(async () => action(await this.confirmed(target)));
    this.queues.set(target.configPath, pending);
    try {
      return await pending;
    } finally {
      if (this.queues.get(target.configPath) === pending) this.queues.delete(target.configPath);
    }
  }
  apply(input: CursorProfileRequest) {
    const parsed = CursorProfileRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new ValidationDomainError('Confirmed target and valid profile are required.');
    const { target, profileId } = parsed.data;
    const profile = CURSOR_PERMISSION_PROFILES.find((entry) => entry.id === profileId)!;
    return this.mutate(target, async (current) => {
      await this.repository.write(current, profile.permissions);
      return {
        success: true as const,
        target: current,
        message: `Applied "${profileId}" profile to ${current.scope}`,
        scope: current.scope,
        profileId,
      };
    });
  }
  custom(input: CursorCustomPermissionsRequest) {
    const parsed = CursorCustomPermissionsRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new ValidationDomainError(
        'Confirmed project target and valid permissions are required.'
      );
    return this.mutate(parsed.data.target, async (target) => {
      await this.repository.write(target, parsed.data.permissions);
      return {
        success: true as const,
        target,
        message: 'Custom permissions saved',
        permissions: parsed.data.permissions,
      };
    });
  }
  delete(input: CursorDeletePermissionsRequest) {
    const parsed = CursorDeletePermissionsRequestSchema.safeParse(input);
    if (!parsed.success) throw new ValidationDomainError('Confirmed project target is required.');
    return this.mutate(parsed.data.target, async (target) => {
      await this.repository.delete(target);
      return {
        success: true as const,
        target,
        message: 'Project permissions deleted, using global config',
      };
    });
  }
  async read(projectPath?: string) {
    this.accepting();
    const globalTarget = await this.resolve('global');
    const projectTarget = projectPath
      ? await this.resolve('project', projectPath, true)
      : undefined;
    const globalConfig = await this.repository.read(globalTarget.configPath);
    const projectConfig = projectTarget
      ? await this.repository.read(projectTarget.configPath)
      : null;
    const globalPermissions = (globalConfig?.permissions ?? null) as CursorCliPermissions | null;
    const projectPermissions = (projectConfig?.permissions ?? null) as CursorCliPermissions | null;
    const effectivePermissions = projectPermissions ?? globalPermissions;
    const sorted = (values: string[]) => JSON.stringify([...values].sort());
    const activeProfile = !effectivePermissions
      ? null
      : (CURSOR_PERMISSION_PROFILES.find(
          (profile) =>
            sorted(profile.permissions.allow) === sorted(effectivePermissions.allow) &&
            sorted(profile.permissions.deny) === sorted(effectivePermissions.deny)
        )?.id ?? 'custom');
    return {
      success: true as const,
      globalPermissions,
      projectPermissions,
      effectivePermissions,
      activeProfile,
      hasProjectConfig: projectPermissions !== null,
      availableProfiles: globalThis.structuredClone(CURSOR_PERMISSION_PROFILES),
      globalTarget,
      ...(projectTarget && { projectTarget }),
    };
  }
  example(profileId: unknown = 'development') {
    this.accepting();
    if (!CursorPermissionProfileIdSchema.safeParse(profileId).success)
      throw new ValidationDomainError('Unknown Cursor permission profile.');
    const profile = CURSOR_PERMISSION_PROFILES.find((entry) => entry.id === profileId)!;
    return {
      success: true as const,
      profileId,
      config: JSON.stringify({ version: 1, permissions: profile.permissions }, null, 2),
    };
  }
  beforeApplicationShutdown(): Promise<void> {
    // Drain accepted writes; repository identity has no host-runtime admission dependency.
    return (this.closing ??= Promise.allSettled([...this.queues.values()]).then(() => undefined));
  }
}
