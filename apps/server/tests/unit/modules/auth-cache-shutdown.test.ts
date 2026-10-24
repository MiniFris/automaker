import { afterEach, expect, it, vi } from 'vitest';
import {
  AuthStateRepository,
  type AuthFilesystem,
} from '../../../src/core/auth/auth-state.repository.js';
import { CodexModelCacheService } from '../../../src/services/codex-model-cache-service.js';
import { parseRuntimeConfig } from '../../../src/core/config/index.js';

afterEach(() => vi.useRealTimers());
it.each(['auth', 'cache'] as const)(
  'bounds %s accepted-write drain and retains the failed close after late completion',
  async (kind) => {
    vi.useFakeTimers();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const filesystem: AuthFilesystem = {
      readFile: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('owned absent fixture'), { code: 'ENOENT' })),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn(() => held),
      unlink: vi.fn().mockResolvedValue(undefined),
    };
    let close: () => Promise<void>, pending: Promise<unknown>, after: () => Promise<unknown>;
    if (kind === 'auth') {
      const store = new AuthStateRepository(
        parseRuntimeConfig({ DATA_DIR: '/unused-mocked-fixture', AUTOMAKER_API_KEY: 'fixture' }),
        filesystem
      );
      await store.onModuleInit();
      pending = store.createSession();
      close = () => store.beforeApplicationShutdown();
      after = () => store.createSession();
    } else {
      const server = {
        isAvailable: vi.fn().mockResolvedValue(true),
        getModels: vi.fn().mockResolvedValue({ data: [] }),
      };
      const store = new CodexModelCacheService(
        '/unused-mocked-fixture',
        server as never,
        3600000,
        filesystem
      );
      pending = store.refreshModels();
      close = () => store.beforeApplicationShutdown();
      after = () => store.getModels();
    }
    const closing = close(),
      rejected = expect(closing).rejects.toMatchObject({
        code: kind === 'auth' ? 'AUTH_STATE_CLEANUP_FAILED' : 'CODEX_MODEL_CACHE_CLEANUP_FAILED',
      });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    await expect(after()).rejects.toThrow();
    release();
    await pending;
    expect(close()).toBe(closing);
    await expect(close()).rejects.toMatchObject({
      code: kind === 'auth' ? 'AUTH_STATE_CLEANUP_FAILED' : 'CODEX_MODEL_CACHE_CLEANUP_FAILED',
    });
  }
);
