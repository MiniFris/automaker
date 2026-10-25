import { Inject, Injectable } from '@nestjs/common';
import { SetupStatusRuntime, type HostCliName } from '../../core/platform/setup-status.runtime.js';
import type { InstallationStatus } from '../../providers/types.js';

const CLI_NAMES: Readonly<Record<string, HostCliName>> = {
  cursor: 'cursor-agent',
  codex: 'codex',
  opencode: 'opencode',
  gemini: 'gemini',
  copilot: 'copilot',
};

/** Installation metadata only: never constructs execution adapters or checks authentication. */
@Injectable()
export class ProviderDiscoveryService {
  constructor(@Inject(SetupStatusRuntime) private readonly runtime: SetupStatusRuntime) {}

  async statuses(names: readonly string[]): Promise<Record<string, InstallationStatus>> {
    return Object.fromEntries(
      await Promise.all(
        names.map(async (name) => {
          const cli = CLI_NAMES[name];
          if (!cli)
            return [
              name,
              { installed: name === 'claude' || name === 'openai-compatible', method: 'sdk' },
            ];
          const detected = await this.runtime.detect(cli);
          return [
            name,
            {
              installed: detected.installed,
              method: 'cli',
              version: detected.version || undefined,
              path: detected.path || undefined,
            },
          ];
        })
      )
    );
  }
}
