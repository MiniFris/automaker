import type { FactoryProvider } from '@nestjs/common';
import { ProviderConnectionCommandService } from './provider-connection-command.service.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { SetupStatusRuntime } from '../../core/platform/setup-status.runtime.js';
import { RUNTIME_CONFIG, HOST_ENVIRONMENT } from '../../core/config/index.js';
import { SetupCredentialsService } from './setup-credentials.service.js';
import { ClaudeVerificationService } from './claude-verification.service.js';
import { CodexVerificationService } from './codex-verification.service.js';
import { GithubAuthenticationService } from './github-authentication.service.js';
import { ApplicationCredentialsService } from './application-credentials.service.js';
import { SettingsService } from '../../services/settings-service.js';
import { ClaudeVerificationRuntime } from '../../core/platform/claude-verification.runtime.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';
import { CodexVerificationRuntime } from '../../core/platform/codex-verification.runtime.js';
import { CodexCredentialRuntime } from '../../core/platform/codex-credential.runtime.js';
import { createSetupCommandValidation } from './setup-command.validation.js';

export const providerConnectionCommandServiceProvider: FactoryProvider<ProviderConnectionCommandService> =
  {
    provide: ProviderConnectionCommandService,
    inject: [ProviderConnectionRepository, SetupStatusRuntime, RUNTIME_CONFIG],
    useFactory: (
      repository: ConstructorParameters<typeof ProviderConnectionCommandService>[0],
      runtime: ConstructorParameters<typeof ProviderConnectionCommandService>[1],
      config: ConstructorParameters<typeof ProviderConnectionCommandService>[2]
    ) => new ProviderConnectionCommandService(repository, runtime, config),
  };

export const setupCredentialsServiceProvider: FactoryProvider<SetupCredentialsService> = {
  provide: SetupCredentialsService,
  inject: [ApplicationCredentialsService, SettingsService, ProviderConnectionRepository],
  useFactory: (
    credentials: ConstructorParameters<typeof SetupCredentialsService>[0],
    settings: ConstructorParameters<typeof SetupCredentialsService>[1],
    connections: ConstructorParameters<typeof SetupCredentialsService>[2]
  ) =>
    new SetupCredentialsService(credentials, settings, connections, createSetupCommandValidation()),
};

export const claudeVerificationServiceProvider: FactoryProvider<ClaudeVerificationService> = {
  provide: ClaudeVerificationService,
  inject: [
    ClaudeVerificationRuntime,
    ProviderConnectionRepository,
    HOST_ENVIRONMENT,
    SetupCredentialCache,
    SettingsService,
  ],
  useFactory: (
    runtime: ConstructorParameters<typeof ClaudeVerificationService>[0],
    connections: ConstructorParameters<typeof ClaudeVerificationService>[1],
    environment: ConstructorParameters<typeof ClaudeVerificationService>[2],
    keys: ConstructorParameters<typeof ClaudeVerificationService>[3],
    settings: ConstructorParameters<typeof ClaudeVerificationService>[4]
  ) =>
    new ClaudeVerificationService(
      runtime,
      connections,
      environment,
      keys,
      settings,
      createSetupCommandValidation()
    ),
};

export const codexVerificationServiceProvider: FactoryProvider<CodexVerificationService> = {
  provide: CodexVerificationService,
  inject: [
    CodexVerificationRuntime,
    CodexCredentialRuntime,
    ProviderConnectionRepository,
    HOST_ENVIRONMENT,
    SetupCredentialCache,
    SettingsService,
  ],
  useFactory: (
    runtime: ConstructorParameters<typeof CodexVerificationService>[0],
    credentials: ConstructorParameters<typeof CodexVerificationService>[1],
    connections: ConstructorParameters<typeof CodexVerificationService>[2],
    environment: ConstructorParameters<typeof CodexVerificationService>[3],
    keys: ConstructorParameters<typeof CodexVerificationService>[4],
    settings: ConstructorParameters<typeof CodexVerificationService>[5]
  ) =>
    new CodexVerificationService(
      runtime,
      credentials,
      connections,
      environment,
      keys,
      settings,
      createSetupCommandValidation()
    ),
};

export const githubAuthenticationServiceProvider: FactoryProvider<GithubAuthenticationService> = {
  provide: GithubAuthenticationService,
  inject: [SetupStatusRuntime, ProviderConnectionRepository, HOST_ENVIRONMENT],
  useFactory: (
    runtime: ConstructorParameters<typeof GithubAuthenticationService>[0],
    connections: ConstructorParameters<typeof GithubAuthenticationService>[1],
    environment: ConstructorParameters<typeof GithubAuthenticationService>[2]
  ) =>
    new GithubAuthenticationService(
      runtime,
      connections,
      environment,
      createSetupCommandValidation()
    ),
};
