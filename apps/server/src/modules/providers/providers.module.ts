import { Global, Module } from '@nestjs/common';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import { ProviderConnectionRepository } from './provider-connection.repository.js';
import { ProviderRegistry } from './provider-registry.service.js';
import { ProviderUsageController } from './provider-usage.controller.js';
import { ProviderUsageService } from './provider-usage.service.js';
import { ProviderSetupStatusService } from './provider-setup-status.service.js';
import { ProviderModelCatalogService } from './provider-model-catalog.service.js';
import { SetupController } from './setup.controller.js';
import { SetupHandlersService } from './setup-handlers.service.js';
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
    { provide: ProviderConnectionRepository, useExisting: LEGACY_SERVICES.providerConnections },
    { provide: ProviderRegistry, useExisting: LEGACY_SERVICES.providerRegistry },
    ProviderUsageService,
    ProviderSetupStatusService,
    ProviderModelCatalogService,
    SetupHandlersService,
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
export class ProvidersModule {}
