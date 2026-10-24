import { Inject, Injectable } from '@nestjs/common';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { SettingsService } from '../../services/settings-service.js';
import {
  resolveApplicationKey,
  SETUP_CREDENTIAL_ENV,
  type SetupCredentialProvider,
} from '../../providers/credential-policy.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';
import { UnavailableDomainError } from '../../core/errors/index.js';

@Injectable()
export class ApplicationCredentialsService {
  private writes: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(HOST_ENVIRONMENT) private readonly bootstrap: Readonly<NodeJS.ProcessEnv>,
    @Inject(SetupCredentialCache) private readonly cache: SetupCredentialCache
  ) {}

  change(provider: SetupCredentialProvider, value: string | null): Promise<void> {
    if (this.closing)
      return Promise.reject(
        new UnavailableDomainError('Application credentials are shutting down.')
      );
    const task = this.writes.then(async () => {
      await this.settings.setSetupCredential(provider, value);
      // Activate only after durable commit. No legacy cache may resurrect the old key.
      this.cache.set(provider, '');
      this.cache.setEnvironmentConfigured(SETUP_CREDENTIAL_ENV[provider], value !== null);
      if (value && provider === 'anthropic') this.cache.set('anthropic_oauth_token', '');
      if (value && provider === 'anthropic_oauth_token') this.cache.set('anthropic', '');
    });
    this.writes = task.catch(() => {});
    return task;
  }

  beforeApplicationShutdown(): Promise<void> {
    this.closing ??= this.writes.then(() => undefined);
    return this.closing;
  }
  async environment(): Promise<NodeJS.ProcessEnv> {
    const credentials = await this.settings.getCredentials();
    const environment = { ...this.bootstrap };
    for (const provider of Object.keys(SETUP_CREDENTIAL_ENV) as SetupCredentialProvider[]) {
      const name = SETUP_CREDENTIAL_ENV[provider];
      const bootstrap = this.cache.isEnvironmentConfigured(name, !!this.bootstrap[name])
        ? this.bootstrap
        : { ...this.bootstrap, [name]: undefined };
      const value =
        this.cache.get(provider) || resolveApplicationKey(credentials, bootstrap, provider);
      if (value) environment[name] = value;
      else delete environment[name];
    }
    const cachedApiKey = this.cache.get('anthropic');
    const cachedOAuth = this.cache.get('anthropic_oauth_token');
    if (cachedApiKey || (!cachedOAuth && credentials.apiKeys.anthropic)) {
      delete environment.ANTHROPIC_AUTH_TOKEN;
      delete environment.CLAUDE_CODE_OAUTH_TOKEN;
    } else if (cachedOAuth || credentials.anthropicOAuthToken) {
      delete environment.ANTHROPIC_API_KEY;
      delete environment.ANTHROPIC_AUTH_TOKEN;
    }
    // A stale alternate Codex key must not override the selected application key.
    if (environment.OPENAI_API_KEY) environment.CODEX_API_KEY = environment.OPENAI_API_KEY;
    else delete environment.CODEX_API_KEY;
    return environment;
  }
}
