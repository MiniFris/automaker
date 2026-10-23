import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';

import type { RuntimeConfig } from './runtime-config.js';
import { RUNTIME_CONFIG, WORKING_DIRECTORY } from './runtime-config.tokens.js';

@Injectable()
export class RuntimePathsService {
  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(WORKING_DIRECTORY) readonly workingDirectory: string
  ) {}

  get dataDirectory(): string {
    return this.config.storage.dataDirectory;
  }

  get allowedRootDirectory(): string | undefined {
    return this.config.storage.allowedRootDirectory;
  }

  resolveFromWorkingDirectory(...segments: string[]): string {
    return path.resolve(this.workingDirectory, ...segments);
  }
}
