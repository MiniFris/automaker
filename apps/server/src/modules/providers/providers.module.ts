import { type DynamicModule, Global, Module } from '@nestjs/common';
import { HOST_ENVIRONMENT, RuntimePathsService } from '../../core/config/index.js';
import { ClaudeUsageService } from '../../services/claude-usage-service.js';
import { CodexUsageService } from '../../services/codex-usage-service.js';
import { CodexAppServerService } from '../../services/codex-app-server-service.js';
import { CodexModelCacheService } from '../../services/codex-model-cache-service.js';
import { GeminiUsageService } from '../../services/gemini-usage-service.js';
import { ZaiUsageService } from '../../services/zai-usage-service.js';
import { CodexModelWarmup, PROVIDER_STARTUP_TASKS } from './codex-model-warmup.service.js';
import {
  CodexUsageRuntime,
  NodeCodexUsageRuntime,
} from '../../core/platform/codex-usage.runtime.js';
import { SettingsService } from '../../services/settings-service.js';
import { createProviderRegistrations } from './provider-registrations.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import {
  ProviderRegistry,
  PROVIDER_REGISTRATIONS,
  indexProviderRegistrations,
  type ProviderRegistration,
} from './provider-registry.service.js';
import { ProviderUsageController } from './provider-usage.controller.js';
import { ProviderUsageService } from './provider-usage.service.js';
import { ProviderSetupStatusService } from './provider-setup-status.service.js';
import { ProviderModelCatalogService } from './provider-model-catalog.service.js';
import { SetupController } from './setup.controller.js';
import { SetupCredentialsService } from './setup-credentials.service.js';
import { ToolPolicyService } from './tool-policy.service.js';
import { HostSetupStatusService } from './host-setup-status.service.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';
import { ProviderConnectionCommandService } from './provider-connection-command.service.js';
import { ProviderInstallGuidanceService } from './provider-install-guidance.service.js';
import { CursorPermissionsRepository } from './cursor-permissions.repository.js';
import { CursorPermissionsService } from './cursor-permissions.service.js';
import { HostSetupJsonFiles } from './host-setup-json-files.js';
import { CursorModelConfigService } from './cursor-model-config.service.js';
import { ClaudeVerificationService } from './claude-verification.service.js';
import { CodexVerificationService } from './codex-verification.service.js';
import { GithubAuthenticationService } from './github-authentication.service.js';
import { ApplicationCredentialsService } from './application-credentials.service.js';
import {
  CodexVerificationRuntime,
  NodeCodexVerificationRuntime,
} from '../../core/platform/codex-verification.runtime.js';
import {
  CodexCredentialRuntime,
  NodeCodexCredentialRuntime,
  CODEX_CREDENTIAL_PROCESS,
  spawnCodexCredentialProcess,
} from '../../core/platform/codex-credential.runtime.js';
import {
  ClaudeVerificationRuntime,
  NodeClaudeVerificationRuntime,
} from '../../core/platform/claude-verification.runtime.js';
import {
  SetupStatusRuntime,
  NodeSetupStatusRuntime,
} from '../../core/platform/setup-status.runtime.js';

@Global()
@Module({
  controllers: [ProviderUsageController, SetupController],
  providers: [
    ProviderConnectionRepository,
    ProviderRegistry,
    {
      provide: ClaudeUsageService,
      inject: [ApplicationCredentialsService, RuntimePathsService],
      useFactory: (credentials: ApplicationCredentialsService, paths: RuntimePathsService) =>
        new ClaudeUsageService(() => credentials.environment(), paths.workingDirectory),
    },
    {
      provide: CodexUsageRuntime,
      inject: [ApplicationCredentialsService, RuntimePathsService],
      useFactory: (credentials: ApplicationCredentialsService, paths: RuntimePathsService) =>
        new NodeCodexUsageRuntime(() => credentials.environment(), paths.workingDirectory),
    },
    {
      provide: CodexAppServerService,
      inject: [CodexUsageRuntime],
      useFactory: (runtime: CodexUsageRuntime) => new CodexAppServerService(runtime),
    },
    {
      provide: CodexUsageService,
      inject: [CodexAppServerService, CodexUsageRuntime],
      useFactory: (appServer: CodexAppServerService, runtime: CodexUsageRuntime) =>
        new CodexUsageService(appServer, runtime),
    },
    {
      provide: CodexModelCacheService,
      inject: [RuntimePathsService, CodexAppServerService],
      useFactory: (paths: RuntimePathsService, appServer: CodexAppServerService) =>
        new CodexModelCacheService(paths.dataDirectory, appServer),
    },
    {
      provide: GeminiUsageService,
      inject: [HOST_ENVIRONMENT, RuntimePathsService],
      useFactory: (environment: Readonly<NodeJS.ProcessEnv>, paths: RuntimePathsService) =>
        new GeminiUsageService(environment, paths.workingDirectory),
    },
    {
      provide: ZaiUsageService,
      inject: [HOST_ENVIRONMENT],
      useFactory: (environment: Readonly<NodeJS.ProcessEnv>) => new ZaiUsageService(environment),
    },
    CodexModelWarmup,
    ProviderUsageService,
    ProviderSetupStatusService,
    ProviderModelCatalogService,
    SetupCredentialsService,
    ToolPolicyService,
    SetupCredentialCache,
    HostSetupStatusService,
    ProviderConnectionCommandService,
    ProviderInstallGuidanceService,
    CursorPermissionsRepository,
    CursorPermissionsService,
    HostSetupJsonFiles,
    CursorModelConfigService,
    ClaudeVerificationService,
    CodexVerificationService,
    GithubAuthenticationService,
    ApplicationCredentialsService,
    { provide: CodexCredentialRuntime, useClass: NodeCodexCredentialRuntime },
    { provide: CODEX_CREDENTIAL_PROCESS, useValue: spawnCodexCredentialProcess },
    { provide: CodexVerificationRuntime, useClass: NodeCodexVerificationRuntime },
    { provide: ClaudeVerificationRuntime, useClass: NodeClaudeVerificationRuntime },
    { provide: SetupStatusRuntime, useClass: NodeSetupStatusRuntime },
  ],
  exports: [
    ProviderRegistry,
    ProviderConnectionRepository,
    ToolPolicyService,
    ApplicationCredentialsService,
  ],
})
export class ProvidersModule {
  static register(
    runStartupTasks: boolean,
    registrations?: readonly ProviderRegistration[]
  ): DynamicModule {
    // Fail before NestFactory.create: a constructor failure there can abort the
    // process after unrelated resource owners have already been instantiated.
    // Never invoke adapter factories during this metadata-only preflight.
    if (registrations !== undefined) indexProviderRegistrations(registrations);
    return {
      module: ProvidersModule,
      providers: [
        { provide: PROVIDER_STARTUP_TASKS, useValue: runStartupTasks },
        registrations !== undefined
          ? { provide: PROVIDER_REGISTRATIONS, useValue: Object.freeze([...registrations]) }
          : {
              provide: PROVIDER_REGISTRATIONS,
              inject: [SettingsService, ApplicationCredentialsService],
              useFactory: (settings: SettingsService, credentials: ApplicationCredentialsService) =>
                createProviderRegistrations(settings, () => credentials.environment()),
            },
      ],
    };
  }
}
