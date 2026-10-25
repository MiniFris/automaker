import path from 'path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { secureFs } from '@automaker/platform';
import { createLogger } from '@automaker/utils';
import type { AppServerModel } from '@automaker/types';
import {
  CodexAppServerCleanupError,
  type CodexAppServerService,
} from './codex-app-server-service.js';
import type { OnApplicationShutdown } from '@nestjs/common';
import { UnavailableDomainError } from '../core/errors/domain-errors.js';

const logger = createLogger('CodexModelCache');
export type CodexModelCacheFilesystem = Pick<
  typeof secureFs,
  'readFile' | 'writeFile' | 'rename' | 'unlink' | 'mkdir'
>;
export class CodexModelCacheStorageError extends UnavailableDomainError {
  constructor(readonly operation: 'read' | 'write') {
    super('Codex model cache storage unavailable.');
  }
}
export class CodexModelCacheCleanupError extends Error {
  readonly code = 'CODEX_MODEL_CACHE_CLEANUP_FAILED';
  constructor() {
    super('Codex model cache cleanup could not be confirmed.');
  }
}

/**
 * Codex model with UI-compatible format
 */
export interface CodexModel {
  id: string;
  label: string;
  description: string;
  hasThinking: boolean;
  supportsVision: boolean;
  tier: 'premium' | 'standard' | 'basic';
  isDefault: boolean;
}

/**
 * Cache structure stored on disk
 */
interface CodexModelCache {
  models: CodexModel[];
  cachedAt: number;
  ttl: number;
}

/**
 * CodexModelCacheService
 *
 * Caches Codex models fetched from app-server with TTL-based invalidation and disk persistence.
 *
 * Features:
 * - 1-hour TTL (configurable)
 * - Atomic file writes (temp file + rename)
 * - Thread-safe (deduplicates concurrent refresh requests)
 * - Optional background warmup owned by the Nest provider lifecycle
 * - Missing/malformed cache fallback and empty results when the provider is unavailable
 * - Storage failures propagate without reporting a successful refresh
 */
export class CodexModelCacheService implements OnApplicationShutdown {
  private cacheFilePath: string;
  private ttl: number;
  private appServerService: CodexAppServerService;
  private inFlightRefresh: Promise<CodexModel[]> | null = null;
  private readonly active = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(
    dataDir: string,
    appServerService: CodexAppServerService,
    ttl: number = 3600000, // 1 hour default
    private readonly filesystem: CodexModelCacheFilesystem = secureFs
  ) {
    this.cacheFilePath = path.join(dataDir, 'codex-models-cache.json');
    this.ttl = ttl;
    this.appServerService = appServerService;
  }

  /**
   * Get models from cache or fetch if stale
   *
   * @param forceRefresh - If true, bypass cache and fetch fresh data
   * @returns Array of Codex models (empty array if unavailable)
   */
  getModels(forceRefresh = false): Promise<CodexModel[]> {
    return this.track(() => this.getModelsInternal(forceRefresh));
  }

  private async getModelsInternal(forceRefresh: boolean): Promise<CodexModel[]> {
    // If force refresh, skip cache
    if (forceRefresh) {
      return this.refreshModelsInternal();
    }

    // Try to load from cache
    const cached = await this.loadFromCache();
    if (cached) {
      const age = Date.now() - cached.cachedAt;
      const isStale = age > cached.ttl;

      if (!isStale) {
        logger.info(
          `[getModels] ✓ Using cached models (${cached.models.length} models, age: ${Math.round(age / 60000)}min)`
        );
        return cached.models;
      }
    }

    // Cache is stale or missing, refresh
    return this.refreshModelsInternal();
  }

  /**
   * Get models with cache metadata
   *
   * @param forceRefresh - If true, bypass cache and fetch fresh data
   * @returns Object containing models and cache timestamp
   */
  getModelsWithMetadata(forceRefresh = false): Promise<{ models: CodexModel[]; cachedAt: number }> {
    return this.track(async () => {
      const models = await this.getModelsInternal(forceRefresh);

      // Try to get the actual cache timestamp
      const cached = await this.loadFromCache();
      const cachedAt = cached?.cachedAt ?? Date.now();

      return { models, cachedAt };
    });
  }

  /**
   * Refresh models from app-server and update cache
   *
   * Thread-safe: Deduplicates concurrent refresh requests
   */
  refreshModels(): Promise<CodexModel[]> {
    return this.track(() => this.refreshModelsInternal());
  }

  private async refreshModelsInternal(): Promise<CodexModel[]> {
    // Deduplicate concurrent refresh requests
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    // Start new refresh
    this.inFlightRefresh = this.doRefresh();

    try {
      const models = await this.inFlightRefresh;
      return models;
    } finally {
      this.inFlightRefresh = null;
    }
  }

  /**
   * Clear the cache file
   */
  clearCache(): Promise<void> {
    return this.track(() => this.clearCacheInternal());
  }

  private async clearCacheInternal(): Promise<void> {
    logger.info('[clearCache] Clearing cache...');

    try {
      await this.filesystem.unlink(this.cacheFilePath);
      logger.info('[clearCache] Cache cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('[clearCache] Failed to clear cache.');
        throw new CodexModelCacheStorageError('write');
      }
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }

  private close(): Promise<void> {
    if (this.closing) return this.closing;
    const deadline = performance.now() + 5000;
    let timer: NodeJS.Timeout | undefined;
    this.closing = Promise.race([
      Promise.allSettled([...this.active]).then((results) => {
        if (performance.now() >= deadline) throw new CodexModelCacheCleanupError();
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CodexModelCacheCleanupError()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }
  beforeApplicationShutdown(): Promise<void> {
    return this.close();
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Codex model cache is shutting down.'));
    const pending = Promise.resolve().then(operation);
    this.active.add(pending);
    void pending.then(
      () => this.active.delete(pending),
      () => this.active.delete(pending)
    );
    return pending;
  }

  /**
   * Internal method to perform the actual refresh
   */
  private async doRefresh(): Promise<CodexModel[]> {
    try {
      // Check if app-server is available
      const isAvailable = await this.appServerService.isAvailable();
      if (!isAvailable) {
        return [];
      }

      // Fetch models from app-server
      const response = await this.appServerService.getModels();
      if (!response || !response.data) {
        return [];
      }

      // Transform models to UI format
      const models = response.data.map((model) => this.transformModel(model));

      // Save to cache
      await this.saveToCache(models);

      logger.info(`[refreshModels] ✓ Fetched fresh models (${models.length} models)`);

      return models;
    } catch (error) {
      if (
        error instanceof CodexAppServerCleanupError ||
        error instanceof CodexModelCacheStorageError
      )
        throw error;
      logger.error('[doRefresh] Refresh failed:', error);
      return [];
    }
  }

  /**
   * Transform app-server model to UI-compatible format
   */
  private transformModel(appServerModel: AppServerModel): CodexModel {
    return {
      id: `codex-${appServerModel.id}`, // Add 'codex-' prefix for compatibility
      label: appServerModel.displayName,
      description: appServerModel.description,
      hasThinking: appServerModel.supportedReasoningEfforts.length > 0,
      supportsVision: true, // All Codex models support vision
      tier: this.inferTier(appServerModel.id),
      isDefault: appServerModel.isDefault,
    };
  }

  /**
   * Infer tier from model ID
   */
  private inferTier(modelId: string): 'premium' | 'standard' | 'basic' {
    if (
      modelId.includes('max') ||
      modelId.includes('gpt-5.2-codex') ||
      modelId.includes('gpt-5.3-codex')
    ) {
      return 'premium';
    }
    if (modelId.includes('mini')) {
      return 'basic';
    }
    return 'standard';
  }

  /**
   * Load cache from disk
   */
  private async loadFromCache(): Promise<CodexModelCache | null> {
    try {
      const content = await this.filesystem.readFile(this.cacheFilePath, 'utf-8');
      const cache = JSON.parse(content.toString()) as CodexModelCache;

      // Validate cache structure
      if (!cache || !Array.isArray(cache.models) || typeof cache.cachedAt !== 'number') {
        logger.warn('[loadFromCache] Invalid cache structure, ignoring');
        return null;
      }

      return cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)
        return null;
      throw new CodexModelCacheStorageError('read');
    }
  }

  /**
   * Save cache to disk (atomic write)
   */
  private async saveToCache(models: CodexModel[]): Promise<void> {
    const cache: CodexModelCache = {
      models,
      cachedAt: Date.now(),
      ttl: this.ttl,
    };

    const tempPath = `${this.cacheFilePath}.tmp.${randomUUID()}`;

    try {
      // Write to temp file
      await this.filesystem.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
      const content = JSON.stringify(cache, null, 2);
      await this.filesystem.writeFile(tempPath, content, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });

      // Atomic rename
      await this.filesystem.rename(tempPath, this.cacheFilePath);
    } catch {
      logger.error('[saveToCache] Failed to save cache.');

      // Clean up temp file
      try {
        await this.filesystem.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new CodexModelCacheStorageError('write');
    }
  }
}
