import {
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApplicationCredentialsService } from './application-credentials.service.js';
import { SetupStatusRuntime } from '../../core/platform/setup-status.runtime.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';

@Injectable()
export class HostSetupStatusService {
  constructor(
    @Inject(SetupStatusRuntime) private readonly runtime: SetupStatusRuntime,
    @Inject(ProviderConnectionRepository)
    private readonly connections: ProviderConnectionRepository,
    @Inject(ApplicationCredentialsService)
    private readonly credentials: ApplicationCredentialsService
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

  async apiKeys() {
    const presence = await this.credentials.presence();
    return {
      success: true,
      hasAnthropicKey: presence.hasAnthropicKey,
      hasGoogleKey: presence.hasGoogleKey,
      hasOpenaiKey: presence.hasOpenaiKey,
    };
  }

  async github() {
    try {
      const cli = await this.runtime.detect('gh');
      const versionMatch = cli.version.match(/gh version ([\d.]+)/);
      return {
        success: true,
        installed: cli.installed,
        authenticationChecked: false,
        authenticated: false,
        user: null,
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
        authenticationChecked: false,
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
        const presence = await this.credentials.presence();
        auth.hasStoredOAuthToken = presence.hasStoredAnthropicOAuthToken;
        auth.hasStoredApiKey = presence.hasStoredAnthropicKey;
        auth.hasEnvApiKey = presence.hasEnvAnthropicKey;
        const indicators = await this.runtime.claudeIndicators();
        auth.hasCredentialsFile = indicators.hasCredentialsFile;
        auth.method = auth.hasEnvApiKey
          ? 'api_key_env'
          : auth.hasStoredApiKey
            ? 'api_key'
            : auth.hasStoredOAuthToken
              ? 'oauth_token'
              : 'none';
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

  async installationStatus(name: 'codex' | 'opencode') {
    try {
      const disconnected = this.connections.isDisconnected(name);
      const cli = await this.runtime.detect(name);
      const presence = disconnected ? undefined : await this.credentials.presence();
      const hasAuthFile = !disconnected && (await this.runtime.profileHint(name));
      const hasApiKey =
        !disconnected &&
        (name === 'codex'
          ? !!presence?.hasOpenaiKey
          : !!presence?.hasOpenaiKey || !!presence?.hasAnthropicKey);
      const installCommand =
        name === 'codex'
          ? 'npm install -g @openai/codex'
          : 'curl -fsSL https://opencode.ai/install | bash';
      return {
        success: true,
        connected: !disconnected,
        installed: cli.installed,
        version: cli.version || null,
        path: cli.path || null,
        auth: {
          authenticated: false,
          authenticationChecked: false,
          method: hasApiKey ? 'api_key' : 'none',
          hasApiKey,
          hasAuthFile,
          ...(name === 'opencode' && {
            hasEnvApiKey: !!presence?.hasEnvAnthropicKey || !!presence?.hasEnvOpenaiKey,
            hasOAuthToken: false,
          }),
        },
        ...(name === 'opencode' && {
          installCommands: {
            macos: installCommand,
            linux: installCommand,
            npm: 'npm install -g opencode-ai',
          },
          ...(!cli.installed && {
            recommendation: 'Install OpenCode CLI to use multi-provider AI models.',
          }),
        }),
        installCommand,
        loginCommand: name === 'codex' ? 'codex login' : 'opencode auth login',
      };
    } catch (error) {
      throw this.failure(error, name);
    }
  }

  private failure(error: unknown, target: string) {
    if (error instanceof ServiceUnavailableException) return error;
    return new InternalServerErrorException({
      success: false,
      error: `Failed to read ${target} status.`,
    });
  }
}
