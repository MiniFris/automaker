import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type {
  CliConnectionProvider,
  ProviderDisconnectRequest,
  ProviderDisconnectResponse,
} from '@automaker/contracts';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';

const messages: Record<CliConnectionProvider, string> = {
  claude: 'Claude CLI is now disconnected from the app',
  codex: 'Codex CLI is now disconnected from the app',
  cursor: 'Cursor CLI is now disconnected from the app',
  gemini: 'Gemini CLI disconnected from app',
  copilot: 'Copilot CLI disconnected from app',
  opencode: 'OpenCode CLI is now disconnected from the app',
};

@Injectable()
export class ProviderConnectionCommandService implements OnApplicationShutdown {
  private readonly active = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(
    @Inject(ProviderConnectionRepository) private readonly repository: ProviderConnectionRepository
  ) {}

  target(provider: CliConnectionProvider) {
    this.assertAccepting();
    return { success: true as const, target: this.repository.target(provider) };
  }

  async disconnect(
    provider: CliConnectionProvider,
    request: ProviderDisconnectRequest
  ): Promise<ProviderDisconnectResponse> {
    this.assertAccepting();
    if (request.confirmed !== true)
      throw new ValidationDomainError('Disconnect requires confirmation.');
    const target = this.repository.target(provider);
    if (
      request.target.kind !== target.kind ||
      request.target.instanceId !== target.instanceId ||
      request.target.provider !== target.provider ||
      request.target.workingDirectory !== target.workingDirectory
    ) {
      throw new ConflictDomainError(
        'Provider connection target changed. Inspect and confirm the target again.'
      );
    }
    const pending = this.repository.disconnect(provider);
    this.active.add(pending);
    try {
      await pending;
      return { success: true, message: messages[provider], target, connected: false };
    } finally {
      this.active.delete(pending);
    }
  }

  private assertAccepting(): void {
    if (this.closing)
      throw new UnavailableDomainError('Provider connection setup is shutting down.');
  }

  onApplicationShutdown(): Promise<void> {
    this.closing ??= Promise.allSettled([...this.active]).then(() => undefined);
    return this.closing;
  }
}
