import { Inject, Injectable, HttpException } from '@nestjs/common';
import { URL } from 'node:url';
import {
  ClaudeVerificationRequestSchema,
  type ClaudeVerificationTarget,
  type ClaudeVerificationRequest,
  type ClaudeVerificationResponse,
} from '@automaker/contracts';
import { modelTimeout, providerModelTimeouts } from '@automaker/types';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import {
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/index.js';
import {
  ClaudeVerificationRuntime,
  type ClaudeVerificationOutcome,
} from '../../core/platform/claude-verification.runtime.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';
import { SettingsService } from '../../services/settings-service.js';

const errors: Record<Exclude<ClaudeVerificationOutcome, 'verified'>, string> = {
  authentication: 'Claude credentials were rejected.',
  billing: 'Claude verification failed because of billing or insufficient credits.',
  'rate-limit': 'Claude verification was rate limited. Try again later.',
  'no-response': 'No successful terminal response received from Claude.',
  timeout: 'Claude verification was cancelled or timed out.',
  failed: 'Claude verification could not be completed.',
};
@Injectable()
export class ClaudeVerificationService {
  private closing: Promise<void> | undefined;
  private readonly active = new Map<Promise<unknown>, AbortController>();
  private readonly attempts = new Map<string, { count: number; reset: number }>();
  constructor(
    @Inject(ClaudeVerificationRuntime) private readonly runtime: ClaudeVerificationRuntime,
    @Inject(ProviderConnectionRepository)
    private readonly connections: ProviderConnectionRepository,
    @Inject(HOST_ENVIRONMENT) private readonly environment: Readonly<NodeJS.ProcessEnv>,
    @Inject(SetupCredentialCache) private readonly keys: SetupCredentialCache,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}
  private accepting() {
    if (this.closing) throw new UnavailableDomainError('Claude verification is shutting down.');
  }
  private resolve(authMethod: 'cli' | 'api_key'): ClaudeVerificationTarget {
    const { instanceId, workingDirectory } = this.connections.target('claude');
    let endpoint: URL;
    try {
      endpoint = new URL(this.environment.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
    } catch {
      throw new UnavailableDomainError('Claude endpoint configuration is invalid.');
    }
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.href.length > 2048
    )
      throw new UnavailableDomainError(
        'Claude endpoint must be an HTTP URL without embedded credentials or query parameters.'
      );
    return {
      kind: 'host-claude-verification',
      provider: 'claude',
      instanceId,
      workingDirectory,
      authMethod,
      endpoint: endpoint.href,
      model: 'claude-sonnet-4-6',
    };
  }
  target(authMethod: unknown) {
    this.accepting();
    if (authMethod !== 'cli' && authMethod !== 'api_key')
      throw new ValidationDomainError('An explicit authentication method is required.');
    return {
      success: true as const,
      protocolVersion: 1 as const,
      target: this.resolve(authMethod),
    };
  }
  async verify(
    input: ClaudeVerificationRequest,
    client: string
  ): Promise<ClaudeVerificationResponse> {
    this.accepting();
    const parsed = ClaudeVerificationRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new ValidationDomainError(
        'Claude verification requires a confirmed target and explicit authentication method.'
      );
    const target = this.resolve(parsed.data.target.authMethod);
    if (
      Object.keys(target).some(
        (field) =>
          target[field as keyof typeof target] !== parsed.data.target[field as keyof typeof target]
      )
    )
      throw new ConflictDomainError(
        'Claude verification target changed. Inspect and confirm it again.'
      );
    const now = Date.now();
    for (const [id, value] of this.attempts) if (value.reset <= now) this.attempts.delete(id);
    const id = client.slice(0, 512);
    const attempt = this.attempts.get(id) ?? { count: 0, reset: now + 60000 };
    if (attempt.count >= 5 || (!this.attempts.has(id) && this.attempts.size >= 1000))
      throw new HttpException(
        { success: false, error: 'Too many Claude verification attempts. Try again later.' },
        429
      );
    if (this.active.size >= 4) throw new UnavailableDomainError('Claude verification is busy.');
    this.attempts.set(id, { ...attempt, count: attempt.count + 1 });
    const controller = new AbortController();
    const result = (
      outcome: ClaudeVerificationOutcome,
      error?: string
    ): ClaudeVerificationResponse => ({
      success: true,
      target,
      authType: target.authMethod,
      authenticated: outcome === 'verified',
      verification: outcome === 'verified' ? 'verified' : 'unverified',
      ...(outcome !== 'verified' && { error: error ?? errors[outcome] }),
    });
    const pending = Promise.resolve().then(async () => {
      let timer = setTimeout(() => controller.abort(), 120000);
      try {
        const global = await this.settings.getGlobalSettings();
        const timeout = Math.min(
          120000,
          modelTimeout(providerModelTimeouts(global, 'claude'), 'connectionTestTimeoutMs')
        );
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), timeout);
        const environment: NodeJS.ProcessEnv = {
          ...this.environment,
          ANTHROPIC_BASE_URL: target.endpoint,
          ANTHROPIC_API_KEY: undefined,
          ANTHROPIC_AUTH_TOKEN: undefined,
          CLAUDE_CODE_OAUTH_TOKEN: undefined,
          CLAUDE_CODE_USE_BEDROCK: undefined,
          CLAUDE_CODE_USE_VERTEX: undefined,
          CLAUDE_CODE_USE_FOUNDRY: undefined,
          ANTHROPIC_CUSTOM_HEADERS: undefined,
        };
        if (target.authMethod === 'api_key') {
          const stored =
            parsed.data.apiKey === undefined && !this.keys.get('anthropic')
              ? await this.settings.getCredentials()
              : undefined;
          const key =
            parsed.data.apiKey ??
            (this.keys.get('anthropic') ||
              stored?.apiKeys.anthropic ||
              (this.keys.isEnvironmentConfigured(
                'ANTHROPIC_API_KEY',
                !!this.environment.ANTHROPIC_API_KEY
              )
                ? this.environment.ANTHROPIC_API_KEY
                : undefined));
          if (!key || !key.trim())
            return result(
              'authentication',
              'No API key configured. Please enter an API key first.'
            );
          if (!key.trim().startsWith('sk-ant-') || key.trim().length < 20)
            return result('authentication', 'Invalid Anthropic API key format.');
          environment.ANTHROPIC_API_KEY = key.trim();
        }
        if (controller.signal.aborted) return result('timeout');
        const outcome = await this.runtime.run({
          cwd: target.workingDirectory,
          model: target.model,
          environment,
          controller,
        });
        return result(controller.signal.aborted ? 'timeout' : outcome);
      } catch {
        return result(controller.signal.aborted ? 'timeout' : 'failed');
      } finally {
        clearTimeout(timer);
      }
    });
    this.active.set(pending, controller);
    try {
      return await pending;
    } finally {
      this.active.delete(pending);
    }
  }
  beforeApplicationShutdown(): Promise<void> {
    if (!this.closing) {
      // Close admission before firing synchronous abort callbacks.
      let finish!: () => void;
      this.closing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const pending = [...this.active];
      for (const [, controller] of pending) controller.abort();
      void Promise.allSettled(pending.map(([task]) => task)).then(finish);
    }
    return this.closing;
  }
}
