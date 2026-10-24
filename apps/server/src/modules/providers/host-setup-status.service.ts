import {
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { SetupStatusRuntime } from '../../core/platform/setup-status.runtime.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';

@Injectable()
export class HostSetupStatusService {
  constructor(
    @Inject(SetupStatusRuntime) private readonly runtime: SetupStatusRuntime,
    @Inject(ProviderConnectionRepository)
    private readonly connections: ProviderConnectionRepository,
    @Inject(SetupCredentialCache) private readonly keys: SetupCredentialCache,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  platform() {
    try {
      const info = this.runtime.platformInfo();
      return {
        success: true,
        ...info,
        isWindows: info.platform === 'win32',
        isMac: info.platform === 'darwin',
        isLinux: info.platform === 'linux',
      };
    } catch (error) {
      throw this.failure(error, 'platform');
    }
  }

  apiKeys() {
    return {
      success: true,
      hasAnthropicKey:
        !!this.keys.get('anthropic') || this.environmentConfigured('ANTHROPIC_API_KEY'),
      hasGoogleKey: !!this.keys.get('google'),
      hasOpenaiKey: !!this.keys.get('openai') || this.environmentConfigured('OPENAI_API_KEY'),
    };
  }

  async github() {
    try {
      const cli = await this.runtime.detect('gh');
      const auth = cli.installed
        ? await this.runtime.githubAuthentication(cli.path)
        : { authenticated: false, user: null };
      const versionMatch = cli.version.match(/gh version ([\d.]+)/);
      return {
        success: true,
        installed: cli.installed,
        ...auth,
        version: cli.version ? (versionMatch?.[1] ?? cli.version.split('\n')[0]) : null,
        path: cli.path || null,
      };
    } catch (error) {
      throw this.failure(error, 'GitHub CLI');
    }
  }

  async claude() {
    try {
      const cli = await this.runtime.detect('claude');
      const auth = {
        authenticated: false,
        method: 'none',
        hasCredentialsFile: false,
        hasToken: false,
        hasStoredOAuthToken: false,
        hasStoredApiKey: false,
        hasEnvApiKey: false,
        oauthTokenValid: false,
        apiKeyValid: false,
        hasCliAuth: false,
        hasRecentActivity: false,
      };
      if (!this.connections.isDisconnected('claude')) {
        auth.hasStoredOAuthToken = !!this.keys.get('anthropic_oauth_token');
        auth.hasStoredApiKey = !!this.keys.get('anthropic');
        auth.hasEnvApiKey = this.environmentConfigured('ANTHROPIC_API_KEY');
        const indicators = await this.runtime.claudeIndicators();
        if (indicators.hasStatsCacheWithActivity) {
          auth.hasRecentActivity = true;
          auth.hasCliAuth = true;
          auth.authenticated = true;
          auth.method = 'cli_authenticated';
        }
        if (!auth.hasCliAuth && indicators.hasSettingsFile && indicators.hasProjectsSessions) {
          auth.hasCliAuth = true;
          auth.authenticated = true;
          auth.method = 'cli_authenticated';
        }
        if (indicators.hasCredentialsFile && indicators.credentials) {
          auth.hasCredentialsFile = true;
          if (indicators.credentials.hasOAuthToken) {
            auth.hasStoredOAuthToken = true;
            auth.oauthTokenValid = true;
            auth.authenticated = true;
            auth.method = 'oauth_token';
          } else if (indicators.credentials.hasApiKey) {
            auth.apiKeyValid = true;
            auth.authenticated = true;
            auth.method = 'api_key';
          }
        }
        if (auth.hasEnvApiKey) {
          auth.authenticated = true;
          auth.apiKeyValid = true;
          auth.method = 'api_key_env';
        }
        if (!auth.authenticated && auth.hasStoredOAuthToken) {
          auth.authenticated = true;
          auth.oauthTokenValid = true;
          auth.method = 'oauth_token';
        }
        if (!auth.authenticated && auth.hasStoredApiKey) {
          auth.authenticated = true;
          auth.apiKeyValid = true;
          auth.method = 'api_key';
        }
      }
      return {
        success: true,
        status: cli.installed ? 'installed' : 'not_installed',
        installed: cli.installed,
        method: cli.method,
        version: cli.version,
        path: cli.path,
        auth,
      };
    } catch (error) {
      throw this.failure(error, 'Claude');
    }
  }

  private failure(error: unknown, target: string) {
    if (error instanceof ServiceUnavailableException) return error;
    return new InternalServerErrorException({
      success: false,
      error: `Failed to read ${target} status.`,
    });
  }

  private environmentConfigured(name: string): boolean {
    return this.keys.isEnvironmentConfigured(
      name,
      this.config.providers.isEnvironmentVariableConfigured(name)
    );
  }
}
