import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createLogger } from '@automaker/utils';

import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { SettingsService } from '../../services/settings-service.js';
import { ClaudeUsageService } from '../../services/claude-usage-service.js';
import { CodexModelCacheService } from '../../services/codex-model-cache-service.js';
import { CodexUsageService } from '../../services/codex-usage-service.js';
import { GeminiUsageService } from '../../services/gemini-usage-service.js';
import { ZaiUsageService } from '../../services/zai-usage-service.js';
import { ProviderRegistry } from './provider-registry.service.js';
import type { ZaiConfigureRequest, ZaiVerifyRequest } from './provider-usage.schemas.js';

const logger = createLogger('ProviderUsage');
export interface ProviderHttpResult {
  readonly status: number;
  readonly body: unknown;
}
const ok = (body: unknown, status = 200): ProviderHttpResult => ({ status, body });
const message = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

@Injectable()
export class ProviderUsageService implements OnModuleInit {
  constructor(
    @Inject(ClaudeUsageService) private readonly claude: ClaudeUsageService,
    @Inject(CodexUsageService) private readonly codex: CodexUsageService,
    @Inject(CodexModelCacheService) private readonly codexModels: CodexModelCacheService,
    @Inject(GeminiUsageService) private readonly gemini: GeminiUsageService,
    @Inject(ZaiUsageService) private readonly zai: ZaiUsageService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const credentials = await this.settings.getCredentials();
      if (credentials.apiKeys?.zai) this.zai.setApiToken(credentials.apiKeys.zai);
    } catch (error) {
      logger.error('Failed to initialize z.ai credentials:', message(error));
    }
  }

  async claudeUsage(): Promise<ProviderHttpResult> {
    try {
      if (!(await this.claude.isAvailable()))
        return ok({
          error: 'Claude CLI not found',
          message: "Please install Claude Code CLI and run 'claude login' to authenticate",
        });
      return ok(await this.claude.fetchUsageData());
    } catch (error) {
      const detail = message(error);
      if (detail.includes('Authentication required') || detail.includes('token_expired'))
        return ok({
          error: 'Authentication required',
          message: "Please run 'claude login' to authenticate",
        });
      if (detail.includes('TRUST_PROMPT_PENDING'))
        return ok({
          error: 'Trust prompt pending',
          message:
            'Claude CLI needs folder permission. Please run "claude" in your terminal and approve access.',
        });
      if (detail.includes('timed out'))
        return ok({
          error: 'Command timed out',
          message: 'The Claude CLI took too long to respond',
        });
      logger.error('Claude usage failed:', detail);
      return ok({ error: detail }, 500);
    }
  }

  async codexUsage(): Promise<ProviderHttpResult> {
    try {
      if (!(await this.codex.isAvailable()))
        return ok({
          error: 'Codex CLI not found',
          message: "Please install Codex CLI and run 'codex login' to authenticate",
        });
      return ok(await this.codex.fetchUsageData());
    } catch (error) {
      const detail = message(error);
      if (detail.includes('not authenticated') || detail.includes('login'))
        return ok({
          error: 'Authentication required',
          message: "Please run 'codex login' to authenticate",
        });
      if (detail.includes('not available') || detail.includes('does not provide'))
        return ok({ error: 'Usage statistics not available', message: detail });
      if (detail.includes('timed out'))
        return ok({
          error: 'Command timed out',
          message: 'The Codex CLI took too long to respond',
        });
      logger.error('Codex usage failed:', detail);
      return ok({ error: detail }, 500);
    }
  }

  async codexModelCatalog(refresh: boolean): Promise<ProviderHttpResult> {
    try {
      const { models, cachedAt } = await this.codexModels.getModelsWithMetadata(refresh);
      return models.length
        ? ok({ success: true, models, cachedAt })
        : ok(
            {
              success: false,
              error: 'Codex CLI not available or not authenticated',
              message: "Please install Codex CLI and run 'codex login' to authenticate",
            },
            503
          );
    } catch (error) {
      logger.error('Codex model discovery failed:', message(error));
      return ok({ success: false, error: message(error) }, 500);
    }
  }

  async geminiUsage(): Promise<ProviderHttpResult> {
    try {
      return ok(await this.gemini.fetchUsageData());
    } catch (error) {
      logger.error('Gemini usage failed:', message(error));
      return ok({
        authenticated: false,
        authMethod: 'none',
        usedPercent: 0,
        remainingPercent: 100,
        lastUpdated: new Date().toISOString(),
        error: `Failed to fetch Gemini usage: ${message(error)}`,
      });
    }
  }

  async geminiStatus(): Promise<ProviderHttpResult> {
    try {
      const status = await this.providers.byName('gemini')!.detectInstallation();
      return ok({
        success: true,
        installed: status.installed,
        version: status.version || null,
        path: status.path || null,
        authenticated: status.authenticated || false,
        authMethod: status.authenticated ? (status.hasApiKey ? 'api_key' : 'cli_login') : 'none',
        hasCredentialsFile: false,
      });
    } catch (error) {
      return ok({ success: false, error: message(error) }, 500);
    }
  }

  async zaiConfigure(request: ZaiConfigureRequest): Promise<ProviderHttpResult> {
    try {
      return ok(
        await this.zai.configure(
          { apiToken: request.apiToken.trim(), apiHost: request.apiHost?.trim() },
          this.settings
        )
      );
    } catch (error) {
      logger.error('z.ai configuration failed:', message(error));
      return ok({ error: message(error) }, 500);
    }
  }

  async zaiVerify(request: ZaiVerifyRequest): Promise<ProviderHttpResult> {
    try {
      return ok(await this.zai.verifyApiKey(request.apiKey));
    } catch (error) {
      return ok({
        success: false,
        authenticated: false,
        error: `Network error: ${message(error)}`,
      });
    }
  }

  async zaiUsage(): Promise<ProviderHttpResult> {
    try {
      if (!this.zai.isAvailable())
        return ok({
          error: 'z.ai API not configured',
          message: 'Set Z_AI_API_KEY environment variable to enable z.ai usage tracking',
        });
      return ok(await this.zai.fetchUsageData());
    } catch (error) {
      const detail = message(error);
      if (detail.includes('not configured') || detail.includes('API token'))
        return ok({
          error: 'API token required',
          message: 'Set Z_AI_API_KEY environment variable to enable z.ai usage tracking',
        });
      if (detail.includes('failed') || detail.includes('request'))
        return ok({ error: 'API request failed', message: detail });
      return ok({ error: detail }, 500);
    }
  }

  zaiStatus(): ProviderHttpResult {
    const available = this.zai.isAvailable();
    return ok({
      success: true,
      available,
      hasApiKey: this.zai.getApiToken() !== null,
      hasEnvApiKey: this.config.providers.isEnvironmentVariableConfigured('Z_AI_API_KEY'),
      message: available ? 'z.ai API is configured' : 'z.ai API token not configured',
    });
  }
}
