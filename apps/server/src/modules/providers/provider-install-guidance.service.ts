import { Inject, Injectable } from '@nestjs/common';
import type { ProviderInstallGuidance } from '@automaker/contracts';
import { ProviderConnectionCommandService } from './provider-connection-command.service.js';

/** Read-only guidance for existing host setup endpoints; never an installer. */
@Injectable()
export class ProviderInstallGuidanceService {
  constructor(
    @Inject(ProviderConnectionCommandService)
    private readonly connections: ProviderConnectionCommandService
  ) {}

  instructions(provider: 'claude' | 'codex'): ProviderInstallGuidance {
    const target = this.connections.target(provider).target;
    const installCommand =
      provider === 'claude'
        ? 'npm install -g @anthropic-ai/claude-code'
        : 'npm install -g @openai/codex';
    return {
      ...(provider === 'claude'
        ? {
            success: false,
            error: `CLI installation requires terminal access. Please install manually using: ${installCommand}`,
          }
        : {
            success: true,
            message: `Please install Codex CLI manually by running: ${installCommand}`,
          }),
      requiresManualInstall: true,
      installationPerformed: false,
      installCommand,
      target,
    };
  }
}
