import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createLogger } from '@automaker/utils';
import { CodexModelCacheService } from '../../services/codex-model-cache-service.js';

export const PROVIDER_STARTUP_TASKS = Symbol('PROVIDER_STARTUP_TASKS');
const logger = createLogger('CodexModelWarmup');

/** Owns the optional background warmup, not the lifetime of every CLI query. */
@Injectable()
export class CodexModelWarmup implements OnApplicationBootstrap, OnApplicationShutdown {
  private pending: Promise<void> | undefined;
  private stopping = false;

  constructor(
    @Inject(CodexModelCacheService) private readonly cache: CodexModelCacheService,
    @Inject(PROVIDER_STARTUP_TASKS) private readonly enabled: boolean
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled || this.stopping || this.pending) return;
    // Publish ownership before invoking the adapter, including synchronous throws.
    this.pending = Promise.resolve()
      .then(() => this.cache.getModels())
      .then(() => undefined)
      .catch(() => {
        logger.warn('Codex model cache warmup failed.');
      });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.pending;
  }
}
