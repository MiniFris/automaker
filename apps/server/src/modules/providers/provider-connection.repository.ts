import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { RuntimePathsService } from '../../core/config/index.js';

const DISCONNECTED_MARKERS: Readonly<Record<string, string>> = Object.freeze({
  claude: '.claude-disconnected',
  codex: '.codex-disconnected',
  cursor: '.cursor-disconnected',
  opencode: '.opencode-disconnected',
  gemini: '.gemini-disconnected',
  copilot: '.copilot-disconnected',
});

@Injectable()
export class ProviderConnectionRepository {
  constructor(private readonly paths: RuntimePathsService) {}

  static forWorkingDirectory(workingDirectory: string): ProviderConnectionRepository {
    return new ProviderConnectionRepository({
      resolveFromWorkingDirectory: (...segments: string[]) =>
        path.resolve(workingDirectory, ...segments),
    } as RuntimePathsService);
  }

  isDisconnected(providerName: string): boolean {
    const marker = DISCONNECTED_MARKERS[providerName.toLowerCase()];
    return marker
      ? fs.existsSync(this.paths.resolveFromWorkingDirectory('.automaker', marker))
      : false;
  }
}
