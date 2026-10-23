import { Inject, Injectable } from '@nestjs/common';
import type { ModelProvider } from '@automaker/types';
import { isDirectModel } from '@automaker/types';

import type { BaseProvider } from '../../providers/base-provider.js';
import type { InstallationStatus, ModelDefinition } from '../../providers/types.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';

export interface ProviderRegistration {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly priority?: number;
  readonly canHandleModel?: (modelId: string) => boolean;
  readonly create: () => BaseProvider;
}

export const PROVIDER_REGISTRATIONS = Symbol('PROVIDER_REGISTRATIONS');

@Injectable()
export class ProviderRegistry {
  private readonly registrations: ReadonlyMap<string, ProviderRegistration>;
  private readonly aliases: ReadonlyMap<string, string>;

  constructor(
    @Inject(PROVIDER_REGISTRATIONS) registrations: readonly ProviderRegistration[],
    @Inject(ProviderConnectionRepository)
    private readonly connections: ProviderConnectionRepository
  ) {
    const providers = new Map<string, ProviderRegistration>();
    const aliases = new Map<string, string>();
    for (const registration of registrations) {
      const name = registration.name.toLowerCase();
      if (!name || providers.has(name) || aliases.has(name)) {
        throw new Error(`Duplicate provider name or alias: ${name || '<empty>'}.`);
      }
      providers.set(name, Object.freeze({ ...registration, name }));
      for (const value of registration.aliases ?? []) {
        const alias = value.toLowerCase();
        if (!alias || alias === name || providers.has(alias) || aliases.has(alias)) {
          throw new Error(`Duplicate provider name or alias: ${alias || '<empty>'}.`);
        }
        aliases.set(alias, name);
      }
    }
    this.registrations = providers;
    this.aliases = aliases;
  }

  names(): readonly string[] {
    return Object.freeze([...this.registrations.keys()]);
  }

  providerNameForModel(modelId: string): ModelProvider {
    const model = modelId.toLowerCase();
    if (isDirectModel(model)) return 'openai-compatible';
    for (const registration of this.sorted()) {
      if (registration.canHandleModel?.(model)) return registration.name as ModelProvider;
    }
    for (const registration of this.sorted()) {
      if (model.startsWith(`${registration.name}-`)) return registration.name as ModelProvider;
    }
    return 'claude';
  }

  providerForModel(modelId: string, options: { throwOnDisconnected?: boolean } = {}): BaseProvider {
    const name = this.providerNameForModel(modelId);
    if (options.throwOnDisconnected !== false && this.connections.isDisconnected(name)) {
      throw new Error(
        `${name.charAt(0).toUpperCase() + name.slice(1)} CLI is disconnected from the app. ` +
          'Please go to Settings > Providers and click "Sign In" to reconnect.'
      );
    }
    const provider = this.byName(name);
    if (provider) return provider;
    if (name !== 'openai-compatible') {
      const fallback = this.byName('claude');
      if (fallback) return fallback;
    }
    throw new Error(`No provider found for model: ${modelId}`);
  }

  byName(name: string): BaseProvider | null {
    const normalized = name.toLowerCase();
    const owner = this.aliases.get(normalized) ?? normalized;
    return this.registrations.get(owner)?.create() ?? null;
  }

  all(): BaseProvider[] {
    return [...this.registrations.values()].map((registration) => registration.create());
  }

  allModels(): ModelDefinition[] {
    return this.all().flatMap((provider) => provider.getAvailableModels());
  }

  async statuses(): Promise<Record<string, InstallationStatus>> {
    const entries = await Promise.all(
      [...this.registrations.entries()].map(async ([name, registration]) => [
        name,
        await registration.create().detectInstallation(),
      ])
    );
    return Object.fromEntries(entries);
  }

  supportsVision(modelId: string): boolean {
    if (isDirectModel(modelId.toLowerCase())) return false;
    const model = this.providerForModel(modelId)
      .getAvailableModels()
      .find(
        (candidate) =>
          candidate.id === modelId ||
          candidate.modelString === modelId ||
          candidate.id.endsWith(`-${modelId}`) ||
          candidate.modelString.endsWith(`-${modelId}`)
      );
    return model?.supportsVision ?? false;
  }

  private sorted(): ProviderRegistration[] {
    return [...this.registrations.values()].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0)
    );
  }
}
