import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { BaseProvider } from '../../providers/base-provider.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { ProviderRegistry } from './provider-registry.service.js';

export type CliSetupProvider = 'gemini' | 'copilot' | 'cursor';

interface CliAuthenticationStatus {
  authenticated: boolean;
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
    @Inject(ProviderConnectionRepository) private readonly connections: ProviderConnectionRepository
  ) {}

  async status(name: CliSetupProvider) {
    try {
      const disconnected = this.connections.isDisconnected(name);
      // Preserve the existing Gemini/Copilot disconnected response without
      // creating an adapter or probing credentials. Cursor still reports installation.
      if (disconnected && name !== 'cursor') {
        return {
          success: true,
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
      return {
        success: true,
        installed,
        version: version || null,
        path: installed ? provider.getCliPath() : null,
        auth: this.auth(name, auth, disconnected),
        ...commands[name],
      };
    } catch {
      // CLI errors can contain credentials, environment dumps or command output.
      throw new InternalServerErrorException({
        success: false,
        error: `Failed to read ${name} status.`,
      });
    }
  }

  private auth(name: CliSetupProvider, auth: CliAuthenticationStatus, disconnected: boolean) {
    const identity = { authenticated: auth.authenticated, method: auth.method };
    if (name === 'cursor' || (name === 'copilot' && disconnected)) return identity;
    if (name === 'gemini') {
      return {
        ...identity,
        hasApiKey: auth.hasApiKey || false,
        ...(!disconnected && { hasEnvApiKey: auth.hasEnvApiKey || false }),
        ...(auth.error && { error: 'Provider authentication check failed.' }),
      };
    }
    return {
      ...identity,
      login: auth.login,
      host: auth.host,
      ...(auth.error && { error: 'Provider authentication check failed.' }),
    };
  }
}
