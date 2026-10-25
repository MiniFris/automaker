import type { SetupCommandValidation } from './setup-command.port.js';
import type {
  CodexVerificationTargetValue,
  CodexVerificationResult,
} from './verification.values.js';
import { RateLimitDomainError } from '../../core/errors/domain-errors.js';

import path from 'node:path';
import os from 'node:os';
import { URL } from 'node:url';

import { modelTimeout, providerModelTimeouts } from '@automaker/types';

import {
  DomainError,
  ConflictDomainError,
  UnavailableDomainError,
  ValidationDomainError,
} from '../../core/errors/domain-errors.js';
import type {
  CodexVerificationRuntime,
  CodexVerificationOutcome,
} from '../../core/platform/codex-verification.runtime.js';
import type { CodexCredentialRuntime } from '../../core/platform/codex-credential.runtime.js';
import type { ProviderConnectionRepository } from './provider-connection.repository.js';
import type { SetupCredentialCache } from './setup-credential-cache.service.js';
import type { SettingsService } from '../../services/settings-service.js';
import { resolveApplicationKey } from '../../providers/credential-policy.js';

const errors: Record<Exclude<CodexVerificationOutcome, 'verified'>, string> = {
  authentication: 'Codex credentials could not be verified.',
  billing: 'Codex verification failed because of billing or insufficient credits.',
  'rate-limit': 'Codex verification was rate limited. Try again later.',
  'no-response': 'No successful terminal response received from Codex.',
  timeout: 'Codex verification was cancelled or timed out.',
  failed: 'Codex verification could not be completed.',
};

export class CodexVerificationService {
  private closing: Promise<void> | undefined;
  private readonly active = new Map<Promise<unknown>, AbortController>();
  private cliActive = false;
  private readonly attempts = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly runtime: CodexVerificationRuntime,
    private readonly credentials: CodexCredentialRuntime,

    private readonly connections: ProviderConnectionRepository,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
    private readonly keys: SetupCredentialCache,
    private readonly settings: SettingsService,
    private readonly validation: SetupCommandValidation
  ) {}
  private accepting() {
    if (this.closing) throw new UnavailableDomainError('Codex verification is shutting down.');
  }
  private async resolve(
    authMethod: 'cli' | 'api_key',
    controller: AbortController
  ): Promise<CodexVerificationTargetValue> {
    const { instanceId, workingDirectory } = this.connections.target('codex');
    const credentialKind =
      authMethod === 'cli' ? (await this.credentials.read(false, controller)).kind : 'api-key';
    let endpoint: URL;
    try {
      endpoint = new URL(
        credentialKind === 'chatgpt'
          ? this.environment.CODEX_VERIFY_CHATGPT_BASE_URL ||
              'https://chatgpt.com/backend-api/codex'
          : this.environment.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      );
    } catch {
      throw new UnavailableDomainError('Codex endpoint configuration is invalid.');
    }
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.href.length > 2000
    )
      throw new UnavailableDomainError(
        'Codex endpoint must be an HTTP URL without embedded credentials or query parameters.'
      );
    if (!endpoint.pathname.replace(/\/$/, '').endsWith('/responses'))
      endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + '/responses';
    return {
      kind: 'host-codex-verification',
      provider: 'codex',
      instanceId,
      workingDirectory,
      authMethod,
      credentialKind,
      ...(authMethod === 'cli' && {
        credentialDirectory: path.resolve(
          workingDirectory,
          this.environment.CODEX_HOME ||
            path.join(
              (process.platform === 'win32'
                ? this.environment.USERPROFILE
                : this.environment.HOME) || os.homedir(),
              '.codex'
            )
        ),
      }),
      endpoint: endpoint.href,
      model: 'gpt-5.2-codex',
    };
  }
  async target(authMethod: unknown) {
    this.accepting();
    const parsed = this.validation.authMethod(authMethod);
    if (!parsed.success)
      throw new ValidationDomainError('An explicit authentication method is required.');
    const target = await this.resolve(parsed.data, new AbortController());
    this.accepting();
    return { success: true as const, protocolVersion: 1 as const, target };
  }
  async verify(input: unknown, client: string): Promise<CodexVerificationResult> {
    this.accepting();
    const parsed = this.validation.codex(input);
    if (!parsed.success)
      throw new ValidationDomainError(
        'Codex verification requires a confirmed target and explicit authentication method.'
      );
    const target = parsed.data.target;
    const now = Date.now();
    for (const [id, value] of this.attempts) if (value.reset <= now) this.attempts.delete(id);
    const id = client.slice(0, 512),
      attempt = this.attempts.get(id) ?? { count: 0, reset: now + 60000 };
    if (attempt.count >= 5 || (!this.attempts.has(id) && this.attempts.size >= 1000))
      throw new RateLimitDomainError('Too many Codex verification attempts. Try again later.');
    if (this.active.size >= 4 || (target.authMethod === 'cli' && this.cliActive))
      throw new UnavailableDomainError('Codex verification is busy.');
    this.attempts.set(id, { ...attempt, count: attempt.count + 1 });
    if (target.authMethod === 'cli') this.cliActive = true;
    const controller = new AbortController();
    const result = (
      outcome: CodexVerificationOutcome,
      error?: string
    ): CodexVerificationResult => ({
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
        clearTimeout(timer);
        timer = setTimeout(
          () => controller.abort(),
          Math.min(
            120000,
            modelTimeout(providerModelTimeouts(global, 'codex'), 'connectionTestTimeoutMs')
          )
        );
        const current = await this.resolve(target.authMethod, controller);
        if (
          Object.keys(current).some(
            (field) =>
              current[field as keyof typeof current] !== target[field as keyof typeof target]
          )
        )
          throw new ConflictDomainError(
            'Codex verification target changed. Inspect and confirm it again.'
          );
        let apiKey: string | undefined;
        if (target.authMethod === 'api_key') {
          const stored =
            parsed.data.apiKey === undefined && !this.keys.get('openai')
              ? await this.settings.getCredentials()
              : undefined;
          apiKey =
            parsed.data.apiKey ??
            (this.keys.get('openai') ||
              resolveApplicationKey(
                stored!,
                {
                  ...this.environment,
                  OPENAI_API_KEY: this.keys.isEnvironmentConfigured(
                    'OPENAI_API_KEY',
                    !!this.environment.OPENAI_API_KEY
                  )
                    ? this.environment.OPENAI_API_KEY
                    : undefined,
                },
                'openai'
              ));
          if (!apiKey?.trim())
            return result(
              'authentication',
              'No API key configured. Please enter an API key first.'
            );
          apiKey = apiKey.trim();
          if (!apiKey.startsWith('sk-') || apiKey.length < 20 || /[\x00-\x20\x7f]/.test(apiKey))
            return result('authentication', 'Invalid OpenAI API key format.');
        }
        if (controller.signal.aborted) return result('timeout');
        if (target.credentialKind === 'not-detected')
          return result(
            'authentication',
            'No Codex CLI credentials detected. Run codex login separately.'
          );
        const outcome = await this.runtime.run({
          endpoint: target.endpoint,
          model: target.model,
          authMethod: target.authMethod,
          credentialKind: target.credentialKind,
          apiKey,
          controller,
        });
        return result(controller.signal.aborted ? 'timeout' : outcome);
      } catch (error) {
        if (controller.signal.aborted) return result('timeout');
        if (error instanceof DomainError) throw error;
        return result('failed');
      } finally {
        clearTimeout(timer);
      }
    });
    this.active.set(pending, controller);
    try {
      return await pending;
    } finally {
      this.active.delete(pending);
      if (target.authMethod === 'cli') this.cliActive = false;
    }
  }
  beforeApplicationShutdown(): Promise<void> {
    if (!this.closing) {
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
