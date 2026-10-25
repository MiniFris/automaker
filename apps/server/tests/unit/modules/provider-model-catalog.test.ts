import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ProviderModelCatalogService } from '../../../src/modules/providers/provider-model-catalog.service.js';
import type { ModelDefinition } from '../../../src/providers/types.js';

const model = (id: string): ModelDefinition => ({
  id,
  name: id,
  modelString: id,
  provider: 'copilot',
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  const adapters: ReturnType<typeof adapter>[] = [];
  function adapter() {
    let cached = false;
    const models = [model(`fixture-${adapters.length}`)];
    return {
      getAvailableModels: vi.fn(() => models),
      hasCachedModels: vi.fn(() => cached),
      refreshModels: vi.fn(async () => {
        cached = true;
        return models;
      }),
      fetchAuthenticatedProviders: vi.fn(async () => [
        { id: 'a', name: 'A', authenticated: true },
        { id: 'b', name: 'B', authenticated: false },
      ]),
    };
  }
  const registry = {
    byName: vi.fn(() => {
      const next = adapter();
      adapters.push(next);
      return next;
    }),
  };
  const service = new ProviderModelCatalogService(registry as never);
  return { registry, service, adapters };
}

describe('application-owned provider model catalog', () => {
  it('drains a retired generation on shutdown and rejects all new admission', async () => {
    const { service, adapters, registry } = fixture();
    const pending = deferred<ModelDefinition[]>();
    const read = service.models('opencode');
    adapters[0].refreshModels.mockImplementation(() => pending.promise);
    await Promise.resolve();
    service.clear('opencode');
    let finished = false;
    const closing = service.onApplicationShutdown();
    expect(service.onApplicationShutdown()).toBe(closing);
    void closing.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    await expect(service.models('copilot')).rejects.toMatchObject({ status: 503 });
    await expect(service.authenticatedProviders()).rejects.toMatchObject({ status: 503 });
    expect(() => service.clear('opencode')).toThrow(ServiceUnavailableException);
    expect(registry.byName).toHaveBeenCalledOnce();
    pending.resolve([model('closed')]);
    await read;
    await closing;
    expect(finished).toBe(true);
  });

  it('waits for auth discovery during shutdown too', async () => {
    const { service, adapters } = fixture();
    const pending = deferred<Array<{ id: string; name: string; authenticated: boolean }>>();
    const read = service.authenticatedProviders();
    adapters[0].fetchAuthenticatedProviders.mockImplementation(() => pending.promise);
    let finished = false;
    const closing = service.onApplicationShutdown().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    pending.resolve([]);
    await read;
    await closing;
    expect(finished).toBe(true);
  });

  it('awaits refresh again when its adapter reports an expired cache', async () => {
    const { service, adapters } = fixture();
    await service.models('opencode');
    adapters[0].hasCachedModels.mockReturnValue(false);
    expect((await service.models('opencode')).cached).toBe(false);
    expect(adapters[0].refreshModels).toHaveBeenCalledTimes(2);
  });

  it.each(['copilot', 'opencode'] as const)(
    'lazily refreshes %s and then reads the same cached adapter',
    async (name) => {
      const { service, registry, adapters } = fixture();
      expect(registry.byName).not.toHaveBeenCalled();
      const first = await service.models(name);
      expect(first).toEqual({
        success: true,
        models: [model('fixture-0')],
        count: 1,
        cached: false,
      });
      expect(await service.models(name)).toEqual({ ...first, cached: true });
      expect(registry.byName).toHaveBeenCalledExactlyOnceWith(name);
      expect(adapters[0].refreshModels).toHaveBeenCalledOnce();
    }
  );

  it('forces refresh while preserving cached=false semantics', async () => {
    const { service, adapters } = fixture();
    await service.models('copilot');
    expect((await service.models('copilot', true)).cached).toBe(false);
    expect(adapters[0].refreshModels).toHaveBeenCalledTimes(2);
  });

  it('coalesces parallel initial and explicit refresh requests for the same generation', async () => {
    const { service, adapters } = fixture();
    const pending = deferred<ModelDefinition[]>();
    const first = service.models('copilot');
    adapters[0].refreshModels.mockImplementation(() => pending.promise);
    const second = service.models('copilot', true);
    await Promise.resolve();
    expect(adapters[0].refreshModels).toHaveBeenCalledOnce();
    pending.resolve([model('coalesced')]);
    expect((await first).models).toEqual([model('coalesced')]);
    expect(await second).toEqual(await first);
  });

  it('retires an in-flight generation on clear; late completion cannot replace the new cache', async () => {
    const { service, adapters, registry } = fixture();
    const pending = deferred<ModelDefinition[]>();
    const old = service.models('opencode');
    adapters[0].refreshModels.mockImplementation(() => pending.promise);
    await Promise.resolve();
    expect(service.clear('opencode')).toEqual({
      success: true,
      message: 'OpenCode model cache cleared',
    });
    expect((await service.models('opencode')).models).toEqual([model('fixture-1')]);
    pending.resolve([model('retired')]);
    expect((await old).models).toEqual([model('retired')]);
    expect((await service.models('opencode')).models).toEqual([model('fixture-1')]);
    expect(registry.byName).toHaveBeenCalledTimes(2);
  });

  it('does not let an old refresh finally clear a new generation refresh promise', async () => {
    const { service, adapters } = fixture();
    const older = deferred<ModelDefinition[]>();
    const newer = deferred<ModelDefinition[]>();
    const old = service.models('opencode');
    adapters[0].refreshModels.mockImplementation(() => older.promise);
    await Promise.resolve();
    service.clear('opencode');
    const next = service.models('opencode');
    adapters[1].refreshModels.mockImplementation(() => newer.promise);
    await Promise.resolve();
    older.resolve([model('old')]);
    await old;
    const joined = service.models('opencode', true);
    newer.resolve([model('new')]);
    expect(await next).toEqual(await joined);
    expect(adapters[1].refreshModels).toHaveBeenCalledOnce();
  });

  it('keeps provider names and application instances isolated', async () => {
    const first = fixture();
    const second = fixture();
    await first.service.models('copilot');
    await first.service.models('opencode');
    await second.service.models('copilot');
    first.service.clear('copilot');
    expect((await first.service.models('opencode')).cached).toBe(true);
    expect((await second.service.models('copilot')).cached).toBe(true);
    expect((await first.service.models('copilot')).cached).toBe(false);
    expect(first.registry.byName).toHaveBeenCalledTimes(3);
    expect(second.registry.byName).toHaveBeenCalledOnce();
  });

  it('allows clearing an uninitialized cache without probing any CLI', () => {
    const { service, registry } = fixture();
    expect(service.clear('copilot')).toEqual({
      success: true,
      message: 'Copilot model cache cleared',
    });
    expect(registry.byName).not.toHaveBeenCalled();
  });

  it('filters authenticated OpenCode providers and shares the discovery adapter with models', async () => {
    const { service, registry } = fixture();
    expect(await service.authenticatedProviders()).toEqual({
      success: true,
      providers: [
        { id: 'a', name: 'A', authenticated: true },
        { id: 'b', name: 'B', authenticated: false },
      ],
      authenticated: [{ id: 'a', name: 'A', authenticated: true }],
    });
    await service.models('opencode');
    expect(registry.byName).toHaveBeenCalledOnce();
  });

  it('allows refresh retry after rejection, without exposing raw credentials', async () => {
    const { service, adapters } = fixture();
    const failed = service.models('copilot');
    adapters[0].refreshModels.mockRejectedValueOnce(new Error('private-credential-dump'));
    await expect(failed).rejects.toMatchObject({
      status: 500,
      response: { success: false, error: 'Failed to read copilot models.' },
    });
    expect((await service.models('copilot')).success).toBe(true);
    expect(adapters[0].refreshModels).toHaveBeenCalledTimes(2);
  });

  it('allows refresh retry after a synchronous adapter throw', async () => {
    const { service, adapters } = fixture();
    const failed = service.models('opencode');
    adapters[0].refreshModels.mockImplementationOnce(() => {
      throw new Error('sync-failure');
    });
    await expect(failed).rejects.toMatchObject({ status: 500 });
    expect((await service.models('opencode')).success).toBe(true);
  });

  it.each([null, {}])(
    'fails closed for missing/incompatible discovery port (%s)',
    async (adapter) => {
      const { service, registry } = fixture();
      registry.byName.mockReturnValue(adapter as never);
      await expect(service.models('opencode')).rejects.toMatchObject({ status: 500 });
    }
  );

  it('returns a safe error for auth discovery failure', async () => {
    const { service, adapters } = fixture();
    await service.models('opencode');
    adapters[0].fetchAuthenticatedProviders.mockRejectedValue(new Error('private-auth-output'));
    await expect(service.authenticatedProviders()).rejects.toMatchObject({
      status: 500,
      response: { success: false, error: 'Failed to read opencode providers.' },
    });
  });
});
