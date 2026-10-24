import { Inject, Injectable, type OnModuleInit, type OnApplicationShutdown } from '@nestjs/common';
import type { ModelProvider } from '@automaker/types';
import { isDirectModel } from '@automaker/types';

import type { BaseProvider } from '../../providers/base-provider.js';
import type { InstallationStatus, ModelDefinition } from '../../providers/types.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { ProviderExecutionScope } from '../../providers/provider-execution-scope.js';
import type { ModelCapabilities } from '../../providers/provider-contract.js';

export interface ProviderRegistration {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly priority?: number;
  readonly canHandleModel?: (modelId: string) => boolean;
  readonly create: () => BaseProvider;
}

export const PROVIDER_REGISTRATIONS = Symbol('PROVIDER_REGISTRATIONS');

/** Pure metadata validation: safe before Nest creates any resource owners. */
export function indexProviderRegistrations(registrations: readonly ProviderRegistration[]) {
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
  return { providers, aliases };
}

@Injectable()
export class ProviderRegistry implements OnModuleInit, OnApplicationShutdown {
  private readonly registrations: ReadonlyMap<string, ProviderRegistration>;
  private readonly aliases: ReadonlyMap<string, string>;
  private readonly executions = new ProviderExecutionScope();

  constructor(
    @Inject(PROVIDER_REGISTRATIONS) registrations: readonly ProviderRegistration[],
    @Inject(ProviderConnectionRepository)
    private readonly connections: ProviderConnectionRepository
  ) {
    const { providers, aliases } = indexProviderRegistrations(registrations);
    this.registrations = providers;
    this.aliases = aliases;
  }

  onModuleInit(): void {
    // Catalog IDs are application-facing, unlike modelString (which may be the
    // same bare SDK model for several providers). Never probe installation/auth
    // here: startup validation must remain offline and side-effect free.
    this.allModels();
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
    const provider = this.registrations.get(owner)?.create();
    if (!provider) return null;
    provider.attachExecutionScope(this.executions);
    return provider;
  }

  all(): BaseProvider[] {
    return [...this.registrations.keys()].map((name) => this.byName(name)!);
  }

  onApplicationShutdown(): Promise<void> {
    return this.executions.dispose();
  }

  allModels(): ModelDefinition[] {
    const owners = new Map<string, string>();
    const models: ModelDefinition[] = [];
    for (const [name, registration] of this.registrations) {
      for (const model of registration.create().getAvailableModels()) {
        const id = model.id.toLowerCase();
        if (!id || id.trim() !== id) {
          throw new Error(`Invalid model ID in provider ${name}.`);
        }
        const owner = owners.get(id);
        if (owner !== undefined) {
          throw new Error(`Duplicate model ID ${id}: providers ${owner} and ${name}.`);
        }
        owners.set(id, name);
        models.push(model);
      }
    }
    return models;
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
    return this.modelCapabilities(modelId).vision;
  }

  modelCapabilities(modelId: string): ModelCapabilities {
    const adapter = this.byName(this.providerNameForModel(modelId));
    const provider = adapter?.getCapabilities();
    const model = adapter?.getModelCapabilities(modelId);
    return Object.freeze({
      vision: provider?.vision === true && model?.vision === true,
      tools: provider?.tools === true && model?.tools === true,
      reasoning: provider?.reasoning === true && model?.reasoning === true,
    });
  }

  private sorted(): ProviderRegistration[] {
    return [...this.registrations.values()].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0)
    );
  }
}
