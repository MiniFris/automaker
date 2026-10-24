import {
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { BaseProvider } from '../../providers/base-provider.js';
import type { ModelDefinition } from '../../providers/types.js';
import { ProviderRegistry } from './provider-registry.service.js';

export type CatalogProvider = 'copilot' | 'opencode';

export interface ModelDiscoveryAdapter {
  getAvailableModels(): ModelDefinition[];
  /** Whether the cached snapshot can be reused without an explicit refresh. */
  hasCachedModels(): boolean;
  refreshModels(): Promise<ModelDefinition[]>;
}

export interface AuthenticatedProvider {
  id: string;
  name: string;
  authenticated: boolean;
  authMethod?: 'oauth' | 'api_key';
}

interface CatalogEntry {
  adapter: BaseProvider & ModelDiscoveryAdapter;
  refresh?: Promise<ModelDefinition[]>;
}

function hasDiscoveryPort(
  provider: BaseProvider | null
): provider is BaseProvider & ModelDiscoveryAdapter {
  return !!(
    provider &&
    'hasCachedModels' in provider &&
    typeof provider.hasCachedModels === 'function' &&
    'refreshModels' in provider &&
    typeof provider.refreshModels === 'function'
  );
}

function hasAuthDiscovery(provider: BaseProvider): provider is BaseProvider & {
  fetchAuthenticatedProviders(): Promise<AuthenticatedProvider[]>;
} {
  return (
    'fetchAuthenticatedProviders' in provider &&
    typeof provider.fetchAuthenticatedProviders === 'function'
  );
}

/** Application-owned discovery adapters, separate from per-execution provider instances. */
@Injectable()
export class ProviderModelCatalogService implements OnApplicationShutdown {
  private readonly entries = new Map<CatalogProvider, CatalogEntry>();
  private readonly active = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(@Inject(ProviderRegistry) private readonly providers: ProviderRegistry) {}

  async models(name: CatalogProvider, forceRefresh = false) {
    this.assertAccepting();
    try {
      const entry = this.entry(name);
      const cached = !forceRefresh && entry.adapter.hasCachedModels();
      const models = cached ? entry.adapter.getAvailableModels() : await this.refresh(entry);
      return { success: true, models, count: models.length, cached };
    } catch {
      throw this.failure(`Failed to read ${name} models.`);
    }
  }

  clear(name: CatalogProvider) {
    this.assertAccepting();
    // Retire the whole adapter generation. An older refresh may finish for its
    // original caller, but cannot repopulate the cache read by later requests.
    this.entries.delete(name);
    return {
      success: true,
      message: `${name === 'copilot' ? 'Copilot' : 'OpenCode'} model cache cleared`,
    };
  }

  async authenticatedProviders() {
    this.assertAccepting();
    try {
      const { adapter } = this.entry('opencode');
      if (!hasAuthDiscovery(adapter)) throw new Error('Provider has no auth discovery port.');
      const providers = await this.track(() => adapter.fetchAuthenticatedProviders());
      return {
        success: true,
        providers,
        authenticated: providers.filter((provider) => provider.authenticated),
      };
    } catch {
      throw this.failure('Failed to read opencode providers.');
    }
  }

  private entry(name: CatalogProvider): CatalogEntry {
    const current = this.entries.get(name);
    if (current) return current;
    const adapter = this.providers.byName(name);
    if (!hasDiscoveryPort(adapter)) throw new Error('Provider has no model discovery port.');
    const entry: CatalogEntry = { adapter };
    this.entries.set(name, entry);
    return entry;
  }

  private async refresh(entry: CatalogEntry): Promise<ModelDefinition[]> {
    if (!entry.refresh) {
      // Defer invocation until the shared promise has been published, including
      // adapters that throw synchronously instead of returning a rejected promise.
      entry.refresh = this.track(() => entry.adapter.refreshModels());
    }
    const pending = entry.refresh;
    try {
      return await pending;
    } finally {
      if (entry.refresh === pending) entry.refresh = undefined;
    }
  }

  onApplicationShutdown(): Promise<void> {
    // Includes retired generations removed by clear(). Admission closes before
    // the scheduled operations run, and close waits for their bounded CLI probes.
    this.closing ??= Promise.allSettled([...this.active]).then(() => {
      this.entries.clear();
    });
    return this.closing;
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    const pending = Promise.resolve().then(operation);
    this.active.add(pending);
    void pending.then(
      () => {
        this.active.delete(pending);
      },
      () => {
        this.active.delete(pending);
      }
    );
    return pending;
  }

  private assertAccepting(): void {
    if (this.closing)
      throw new ServiceUnavailableException({
        success: false,
        error: 'Provider model discovery is shutting down.',
      });
  }

  private failure(error: string) {
    return new InternalServerErrorException({ success: false, error });
  }
}
