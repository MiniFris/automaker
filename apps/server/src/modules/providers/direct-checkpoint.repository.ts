import { Inject, Injectable } from '@nestjs/common';
import { RuntimePathsService } from '../../core/config/index.js';
import { SECURE_FILESYSTEM } from '../../core/security/security.module.js';
import {
  AgentCheckpointStore,
  CheckpointCleanupError,
  type CheckpointFilesystem,
} from '../../providers/openai-compatible/checkpoint.js';
import { ProviderRegistry } from './provider-registry.service.js';

/** Final provider saves finish before checkpoint admission closes and scoped IO drains. */
@Injectable()
export class DirectCheckpointRepository extends AgentCheckpointStore {
  private disposal?: Promise<void>;
  constructor(
    @Inject(RuntimePathsService) paths: RuntimePathsService,
    @Inject(SECURE_FILESYSTEM) filesystem: CheckpointFilesystem,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry
  ) {
    super(paths.dataDirectory, filesystem);
  }
  onModuleDestroy(): Promise<void> {
    return (this.disposal ??= (async () => {
      let providerFailed = false;
      try {
        await this.registry.close();
      } catch {
        providerFailed = true;
      }
      // A failed provider drain must never skip the accepted storage operations.
      await this.close();
      if (providerFailed) throw new CheckpointCleanupError();
    })());
  }
}
