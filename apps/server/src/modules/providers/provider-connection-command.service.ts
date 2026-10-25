import type { ProviderDisconnectResult, ProviderReconnectResult } from './application.outputs.js';
import type {
  HostCliProvider,
  ProviderDisconnectInput,
  ProviderReconnectInput,
} from './application.inputs.js';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { PROVIDER_CONNECTION_PROTOCOL_VERSION } from '@automaker/contracts';
import { SetupStatusRuntime } from '../../core/platform/setup-status.runtime.js';
import { type RuntimeConfig } from '../../core/config/index.js';

const messages: Record<HostCliProvider, string> = {
  claude: 'Claude CLI is now disconnected from the app',
  codex: 'Codex CLI is now disconnected from the app',
  cursor: 'Cursor CLI is now disconnected from the app',
  gemini: 'Gemini CLI disconnected from app',
  copilot: 'Copilot CLI disconnected from app',
  opencode: 'OpenCode CLI is now disconnected from the app',
};

export class ProviderConnectionCommandService {
  private readonly active = new Set<Promise<unknown>>();
  private readonly queues = new Map<HostCliProvider, Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(
    private readonly repository: ProviderConnectionRepository,
    private readonly runtime: SetupStatusRuntime,
    private readonly config: RuntimeConfig
  ) {}

  target(provider: HostCliProvider) {
    this.assertAccepting();
    return {
      success: true as const,
      protocolVersion: PROVIDER_CONNECTION_PROTOCOL_VERSION,
      target: this.repository.target(provider),
    };
  }

  async disconnect(
    provider: HostCliProvider,
    request: ProviderDisconnectInput
  ): Promise<ProviderDisconnectResult> {
    const target = this.confirm(provider, request);
    return this.enqueue<ProviderDisconnectResult>(provider, async () => {
      await this.repository.disconnect(provider);
      return { success: true, message: messages[provider], target, connected: false };
    });
  }

  async reconnect(
    provider: HostCliProvider,
    request: ProviderReconnectInput
  ): Promise<ProviderReconnectResult> {
    const target = this.confirm(provider, request);
    return this.enqueue<ProviderReconnectResult>(provider, async () => {
      let evidence: boolean | undefined;
      try {
        if (provider === 'claude') {
          const indicators = await this.runtime.claudeIndicators();
          evidence =
            indicators.hasStatsCacheWithActivity ||
            (indicators.hasSettingsFile && indicators.hasProjectsSessions) ||
            indicators.hasCredentialsFile;
        } else if (provider === 'codex') {
          const indicators = await this.runtime.codexIndicators();
          evidence = indicators.hasApiKey || indicators.hasAuthFile || indicators.hasOAuthToken;
        } else if (provider === 'cursor') {
          evidence =
            this.config.providers.isEnvironmentVariableConfigured('CURSOR_API_KEY') ||
            (await this.runtime.cursorCredentials());
        } else if (provider === 'opencode') {
          evidence = this.config.providers.isEnvironmentVariableConfigured('OPENCODE_API_KEY');
        }
      } catch {
        throw new UnavailableDomainError(
          'Provider credential evidence could not be read. No reconnect was performed.'
        );
      }
      await this.repository.reconnect(provider);
      const label = {
        claude: 'Claude',
        codex: 'Codex',
        cursor: 'Cursor',
        opencode: 'OpenCode',
        gemini: 'Gemini',
        copilot: 'Copilot',
      }[provider];
      const commands = {
        claude: 'claude login',
        codex: 'codex login',
        cursor: 'cursor auth',
        opencode: 'OpenCode',
      };
      const message =
        provider === 'gemini' || provider === 'copilot'
          ? `${label} CLI connected to app`
          : evidence
            ? `${label} CLI is now linked with the app`
            : provider === 'opencode'
              ? 'OpenCode CLI is now linked with the app. If prompted, please authenticate with OpenCode.'
              : `${label} CLI is now linked with the app. If prompted, please authenticate with "${commands[provider]}" in your terminal.`;
      return {
        success: true,
        connected: true,
        target,
        message,
        credentialStatus:
          evidence === undefined
            ? 'not-inspected'
            : evidence
              ? 'present-unverified'
              : 'not-detected',
        ...(evidence === undefined
          ? {}
          : evidence
            ? { wasAlreadyAuthenticated: true }
            : { requiresManualAuth: true }),
      };
    });
  }

  private confirm(provider: HostCliProvider, request: ProviderDisconnectInput) {
    this.assertAccepting();
    if (request.confirmed !== true)
      throw new ValidationDomainError('Connection change requires confirmation.');
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
    return target;
  }

  private async enqueue<T>(provider: HostCliProvider, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(provider) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    this.queues.set(provider, pending);
    this.active.add(pending);
    try {
      return await pending;
    } finally {
      this.active.delete(pending);
      if (this.queues.get(provider) === pending) this.queues.delete(provider);
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

  beforeApplicationShutdown(): Promise<void> {
    // Drain accepted hint reads before the host runtime closes its own admission.
    return this.onApplicationShutdown();
  }
}
