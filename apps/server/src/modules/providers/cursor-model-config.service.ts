import { Inject, Injectable } from '@nestjs/common';
import {
  CursorModelConfigSchema,
  CursorDefaultModelRequestSchema,
  CursorEnabledModelsRequestSchema,
  type CursorModelConfigTarget,
  type CursorDefaultModelRequest,
  type CursorEnabledModelsRequest,
} from '@automaker/contracts';
import { CURSOR_MODEL_MAP, getAllCursorModelIds } from '@automaker/types';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { HostSetupJsonFiles } from './host-setup-json-files.js';

@Injectable()
export class CursorModelConfigService {
  private closing: Promise<void> | undefined;
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(
    @Inject(HostSetupJsonFiles) private readonly files: HostSetupJsonFiles,
    @Inject(ProviderConnectionRepository) private readonly connections: ProviderConnectionRepository
  ) {}
  private accepting() {
    if (this.closing)
      throw new UnavailableDomainError('Cursor model configuration is shutting down.');
  }
  private async resolve(
    projectPath: string,
    allowMissing = false
  ): Promise<CursorModelConfigTarget> {
    const { instanceId, workingDirectory } = this.connections.target('cursor');
    return {
      kind: 'host-cursor-model-config',
      provider: 'cursor',
      scope: 'project',
      instanceId,
      workingDirectory,
      ...(await this.files.projectLocation(
        projectPath,
        '.automaker',
        'cursor-config.json',
        allowMissing
      )),
    };
  }
  async target(projectPath: string) {
    this.accepting();
    return {
      success: true as const,
      protocolVersion: 1 as const,
      target: await this.resolve(projectPath),
    };
  }
  private async readConfig(file: string) {
    const existing = await this.files.read(file);
    if (!existing) return { defaultModel: 'cursor-auto', models: getAllCursorModelIds() };
    const parsed = CursorModelConfigSchema.safeParse(existing);
    if (!parsed.success) throw new UnavailableDomainError('Cursor model configuration is invalid.');
    return parsed.data;
  }
  async read(projectPath: string) {
    this.accepting();
    // A missing project is a read-only default, never an implicit mkdir/write target.
    const target = await this.resolve(projectPath, true);
    return {
      success: true as const,
      target,
      config: await this.readConfig(target.configPath),
      availableModels: globalThis.structuredClone(Object.values(CURSOR_MODEL_MAP)),
    };
  }
  private async mutate<T>(
    target: CursorModelConfigTarget,
    action: (current: CursorModelConfigTarget) => Promise<T>
  ) {
    this.accepting();
    const previous = this.queues.get(target.configPath) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.resolve(target.projectPath);
        if (
          current.kind !== target.kind ||
          current.provider !== target.provider ||
          current.scope !== target.scope ||
          current.instanceId !== target.instanceId ||
          current.workingDirectory !== target.workingDirectory ||
          current.configPath !== target.configPath ||
          current.projectPath !== target.projectPath
        )
          throw new ConflictDomainError(
            'Cursor model config target changed. Inspect and confirm it again.'
          );
        return action(current);
      });
    this.queues.set(target.configPath, pending);
    try {
      return await pending;
    } finally {
      if (this.queues.get(target.configPath) === pending) this.queues.delete(target.configPath);
    }
  }
  setDefaultModel(input: CursorDefaultModelRequest) {
    const parsed = CursorDefaultModelRequestSchema.safeParse(input);
    if (!parsed.success || !Object.hasOwn(CURSOR_MODEL_MAP, parsed.data.model))
      throw new ValidationDomainError('A confirmed target and known Cursor model are required.');
    const { target, model } = parsed.data;
    return this.mutate(target, async (current) => {
      const existing = await this.readConfig(current.configPath);
      await this.files.replace(current.configPath, { ...existing, defaultModel: model });
      return { success: true as const, target: current, model };
    });
  }
  setEnabledModels(input: CursorEnabledModelsRequest) {
    const parsed = CursorEnabledModelsRequestSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.models.some((model) => !Object.hasOwn(CURSOR_MODEL_MAP, model))
    )
      throw new ValidationDomainError(
        'A confirmed target and non-empty list of known Cursor models are required.'
      );
    const { target, models } = parsed.data;
    return this.mutate(target, async (current) => {
      const existing = await this.readConfig(current.configPath);
      await this.files.replace(current.configPath, { ...existing, models });
      return { success: true as const, target: current, models };
    });
  }
  beforeApplicationShutdown(): Promise<void> {
    return (this.closing ??= Promise.allSettled([...this.queues.values()]).then(() => undefined));
  }
}
