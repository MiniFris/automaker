import { describe, expect, it, vi } from 'vitest';
import { CodexModelWarmup } from '../../../src/modules/providers/codex-model-warmup.service.js';
import { CodexModelCacheService } from '../../../src/services/codex-model-cache-service.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Nest-owned Codex model lifecycle', () => {
  it('starts warmup once, in background, and drains it at shutdown', async () => {
    const pending = deferred<never[]>();
    const cache = { getModels: vi.fn(() => pending.promise) };
    const warmup = new CodexModelWarmup(cache as never, true);
    expect(warmup.onApplicationBootstrap()).toBeUndefined();
    warmup.onApplicationBootstrap();
    await Promise.resolve();
    expect(cache.getModels).toHaveBeenCalledOnce();
    let stopped = false;
    const closing = warmup.onApplicationShutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    pending.resolve([]);
    await closing;
    warmup.onApplicationBootstrap();
    expect(cache.getModels).toHaveBeenCalledOnce();
  });

  it.each([false, true])('does not launch warmup after shutdown (enabled=%s)', async (enabled) => {
    const cache = { getModels: vi.fn() };
    const warmup = new CodexModelWarmup(cache as never, enabled);
    await warmup.onApplicationShutdown();
    warmup.onApplicationBootstrap();
    await Promise.resolve();
    expect(cache.getModels).not.toHaveBeenCalled();
  });

  it('does not probe when startup tasks are disabled', async () => {
    const cache = { getModels: vi.fn() };
    const warmup = new CodexModelWarmup(cache as never, false);
    warmup.onApplicationBootstrap();
    await warmup.onApplicationShutdown();
    expect(cache.getModels).not.toHaveBeenCalled();
  });

  it.each(['sync', 'async'])(
    'handles %s adapter failure without rejecting shutdown',
    async (mode) => {
      const cache = {
        getModels: vi.fn(() => {
          if (mode === 'sync') throw new Error('private-adapter-detail');
          return Promise.reject(new Error('private-adapter-detail'));
        }),
      };
      const warmup = new CodexModelWarmup(cache as never, true);
      warmup.onApplicationBootstrap();
      await expect(warmup.onApplicationShutdown()).resolves.toBeUndefined();
    }
  );

  it('closes cache admission and drains all accepted refreshes, including deferred invocation', async () => {
    const pending = deferred<boolean>();
    const appServer = { isAvailable: vi.fn(() => pending.promise), getModels: vi.fn() };
    const cache = new CodexModelCacheService('/unused-no-io', appServer as never);
    const reads = [cache.getModels(true), cache.getModelsWithMetadata(true), cache.refreshModels()];
    // No underlying operation has run yet, but all three already belong to the owner.
    let stopped = false;
    const closing = cache.onApplicationShutdown();
    expect(cache.onApplicationShutdown()).toBe(closing);
    void closing.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(appServer.isAvailable).toHaveBeenCalledOnce();
    await expect(cache.getModels()).rejects.toThrow('Codex model cache is shutting down.');
    await expect(cache.getModelsWithMetadata()).rejects.toThrow(
      'Codex model cache is shutting down.'
    );
    await expect(cache.refreshModels()).rejects.toThrow('Codex model cache is shutting down.');
    await expect(cache.clearCache()).rejects.toThrow('Codex model cache is shutting down.');
    pending.resolve(false);
    await Promise.all(reads);
    await closing;
    expect(stopped).toBe(true);
    expect(appServer.getModels).not.toHaveBeenCalled();
  });
});
