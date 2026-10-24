import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  CopilotSetupStatusSchema,
  GeminiSetupStatusSchema,
  CursorSetupStatusSchema,
} from '@automaker/contracts';
import type { BaseProvider } from '../../providers/base-provider.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { ProviderRegistry } from './provider-registry.service.js';

export type CliSetupProvider = 'gemini' | 'copilot' | 'cursor';

interface CliAuthenticationStatus {
  authenticated: boolean;
  hasEnvToken?: boolean;
  hasConfigFile?: boolean;
  hasCredentialsFile?: boolean;
  hasVertexConfig?: boolean;
  method: string;
  hasApiKey?: boolean;
  hasEnvApiKey?: boolean;
  login?: string;
  host?: string;
  error?: string;
}

/** Read-only setup port, independent of provider implementation classes. */
export interface CliSetupAdapter {
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getCliPath(): string | null;
  checkAuth(): Promise<CliAuthenticationStatus>;
}

function hasSetupPort(provider: BaseProvider | null): provider is BaseProvider & CliSetupAdapter {
  return !!(
    provider &&
    'isInstalled' in provider &&
    typeof provider.isInstalled === 'function' &&
    'getVersion' in provider &&
    typeof provider.getVersion === 'function' &&
    'getCliPath' in provider &&
    typeof provider.getCliPath === 'function' &&
    'checkAuth' in provider &&
    typeof provider.checkAuth === 'function'
  );
}

const commands = {
  gemini: { installCommand: 'npm install -g @google/gemini-cli', loginCommand: 'gemini' },
  copilot: { installCommand: 'npm install -g @github/copilot', loginCommand: 'gh auth login' },
  cursor: {
    installCommand: 'curl https://cursor.com/install -fsS | bash',
    loginCommand: 'cursor-agent login',
  },
} satisfies Record<CliSetupProvider, { installCommand: string; loginCommand: string }>;

@Injectable()
export class ProviderSetupStatusService {
  constructor(
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry,
    @Inject(ProviderConnectionRepository)
    private readonly connections: ProviderConnectionRepository
  ) {}

  async status(name: CliSetupProvider) {
    try {
      const disconnected = this.connections.isDisconnected(name);
      // Preserve the existing Gemini/Copilot disconnected response without
      // creating an adapter or probing credentials. Cursor still reports installation.
      if (disconnected && name !== 'cursor') {
        return {
          success: true,
          connected: false,
          installed: true,
          version: null,
          path: null,
          auth: this.auth(name, { authenticated: false, method: 'none' }, true),
          ...commands[name],
        };
      }
      const provider = this.providers.byName(name);
      if (!hasSetupPort(provider)) throw new Error('Provider has no CLI setup port.');
      // detectInstallation also checks auth for these providers. Do not call
      // it and then repeat the same authentication check as the legacy routes did.
      const [installed, version, auth] = await Promise.all([
        provider.isInstalled(),
        provider.getVersion(),
        disconnected
          ? Promise.resolve({ authenticated: false, method: 'none' })
          : provider.checkAuth(),
      ]);
      const result = {
        success: true,
        connected: !disconnected,
        installed,
        version: version || null,
        path: installed ? provider.getCliPath() : null,
        auth: this.auth(name, auth, disconnected),
        ...commands[name],
      };
      if (name === 'copilot') return CopilotSetupStatusSchema.parse(result);
      if (name === 'gemini') return GeminiSetupStatusSchema.parse(result);
      return CursorSetupStatusSchema.parse(result);
    } catch {
      // CLI errors can contain credentials, environment dumps or command output.
      throw new InternalServerErrorException({
        success: false,
        error: `Failed to read ${name} status.`,
      });
    }
  }

  private auth(name: CliSetupProvider, auth: CliAuthenticationStatus, disconnected: boolean) {
    if (name === 'copilot') {
      return {
        authenticated: false,
        authenticationChecked: false,
        method: !disconnected && auth.hasEnvToken ? 'oauth' : 'none',
        hasEnvToken: !disconnected && !!auth.hasEnvToken,
        hasConfigFile: !disconnected && !!auth.hasConfigFile,
        ...(!disconnected &&
          auth.error && { error: 'Local configuration could not be inspected.' }),
      };
    }
    if (name === 'cursor')
      return {
        authenticated: false,
        authenticationChecked: false,
        scope: 'host',
        method: !disconnected && auth.hasEnvApiKey ? 'api_key' : 'none',
        hasEnvApiKey: !disconnected && !!auth.hasEnvApiKey,
        hasCredentialsFile: !disconnected && !!auth.hasCredentialsFile,
        ...(!disconnected &&
          auth.error && { error: 'Local configuration could not be inspected.' }),
      };
    return {
      authenticated: false,
      authenticationChecked: false,
      method: disconnected
        ? 'none'
        : auth.hasApiKey
          ? auth.method === 'vertex_ai'
            ? 'vertex_ai'
            : 'api_key'
          : auth.hasVertexConfig
            ? 'vertex_ai'
            : 'none',
      hasApiKey: !disconnected && !!auth.hasApiKey,
      hasEnvApiKey: !disconnected && !!auth.hasEnvApiKey,
      hasConfigFile: !disconnected && !!auth.hasConfigFile,
      hasVertexConfig: !disconnected && !!auth.hasVertexConfig,
      ...(!disconnected && auth.error && { error: 'Local configuration could not be inspected.' }),
    };
  }
}
