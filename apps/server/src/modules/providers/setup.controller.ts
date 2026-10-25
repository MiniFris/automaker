import {
  SetupClaudeStatusResponseSchema,
  SetupGithubStatusResponseSchema,
  SetupInstallationStatusResponseSchema,
  CursorSetupStatusSchema,
  GeminiSetupStatusSchema,
  CopilotSetupStatusSchema,
  ProviderInstallGuidanceSchema,
  ProviderConnectionTargetResponseSchema,
  SetupCredentialTargetResponseSchema,
  SetupCredentialMutationResponseSchema,
  SetupKeyPresenceResponseSchema,
  SetupPlatformResponseSchema,
  ClaudeVerificationTargetResponseSchema,
  ClaudeVerificationResponseSchema,
  CodexVerificationTargetResponseSchema,
  CodexVerificationResponseSchema,
  GithubAuthenticationTargetResponseSchema,
  GithubAuthenticationResponseSchema,
  SetupModelsResponseSchema,
  SetupCacheClearResponseSchema,
  SetupAuthenticatedProvidersResponseSchema,
  CursorModelConfigTargetResponseSchema,
  CursorModelConfigResponseSchema,
  CursorDefaultModelResponseSchema,
  CursorEnabledModelsResponseSchema,
  CursorPermissionsTargetResponseSchema,
  SetupCursorPermissionsReadResponseSchema,
  CursorPermissionsMutationResponseSchema,
  SetupCursorPermissionsExampleResponseSchema,
  ProviderReconnectResponseSchema,
  ProviderDisconnectResponseSchema,
} from '@automaker/contracts/domains/setup-responses';
import {
  ProviderRefreshQuerySchema,
  SetupQueryValueSchema,
} from '@automaker/contracts/domains/setup-query';
import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import {
  CliConnectionProviderSchema,
  ProviderDisconnectRequestSchema,
  ProviderReconnectRequestSchema,
  CursorProfileRequestSchema,
  CursorCustomPermissionsRequestSchema,
  CursorDeletePermissionsRequestSchema,
  type CursorProfileRequest,
  type CursorCustomPermissionsRequest,
  type CursorDeletePermissionsRequest,
  CursorDefaultModelRequestSchema,
  CursorEnabledModelsRequestSchema,
  type CursorDefaultModelRequest,
  type CursorEnabledModelsRequest,
  ClaudeVerificationRequestSchema,
  type ClaudeVerificationRequest,
  CodexVerificationRequestSchema,
  type CodexVerificationRequest,
  GithubAuthenticationRequestSchema,
  type GithubAuthenticationRequest,
  SetupCredentialStoreRequestSchema,
  SetupCredentialDeleteRequestSchema,
  type SetupCredentialStoreRequest,
  type SetupCredentialDeleteRequest,
  type CliConnectionProvider,
  type ProviderDisconnectRequest,
  type ProviderReconnectRequest,
} from '@automaker/contracts';
import { ClientIdentity } from '../../core/http/request-context.decorators.js';
import type { ClientIdentityContext } from '@automaker/contracts/domains/request-context';

import { Public } from '../../core/auth/index.js';
import { SetupCredentialsService } from './setup-credentials.service.js';
import { ProviderSetupStatusService } from './provider-setup-status.service.js';
import { ProviderModelCatalogService } from './provider-model-catalog.service.js';
import { HostSetupStatusService } from './host-setup-status.service.js';
import { ProviderConnectionCommandService } from './provider-connection-command.service.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { ProviderInstallGuidanceService } from './provider-install-guidance.service.js';
import { CursorPermissionsService } from './cursor-permissions.service.js';
import { CursorModelConfigService } from './cursor-model-config.service.js';
import { ClaudeVerificationService } from './claude-verification.service.js';
import { CodexVerificationService } from './codex-verification.service.js';
import { GithubAuthenticationService } from './github-authentication.service.js';

@Public()
@Controller('setup')
export class SetupController {
  constructor(
    @Inject(SetupCredentialsService) private readonly credentials: SetupCredentialsService,
    @Inject(ProviderSetupStatusService) private readonly statuses: ProviderSetupStatusService,
    @Inject(ProviderModelCatalogService) private readonly catalogs: ProviderModelCatalogService,
    @Inject(HostSetupStatusService) private readonly hostStatus: HostSetupStatusService,
    @Inject(ProviderConnectionCommandService)
    private readonly connections: ProviderConnectionCommandService,
    @Inject(ProviderInstallGuidanceService)
    private readonly installation: ProviderInstallGuidanceService,
    @Inject(CursorPermissionsService) private readonly permissions: CursorPermissionsService,
    @Inject(CursorModelConfigService) private readonly modelConfig: CursorModelConfigService,
    @Inject(ClaudeVerificationService) private readonly verification: ClaudeVerificationService,
    @Inject(CodexVerificationService) private readonly codexVerification: CodexVerificationService,
    @Inject(GithubAuthenticationService)
    private readonly githubAuthentication: GithubAuthenticationService
  ) {}

  @Get('claude-status') async claudeStatus() {
    return SetupClaudeStatusResponseSchema.parse(await this.hostStatus.claude());
  }
  @Post('install-claude') @HttpCode(200) async installClaude() {
    return ProviderInstallGuidanceSchema.parse(await this.installation.instructions('claude'));
  }
  @Post('auth-claude') @HttpCode(200) async authClaude(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return ProviderReconnectResponseSchema.parse(await this.connections.reconnect('claude', body));
  }
  @Get('connection-target') async connectionTarget(
    @Query('provider', new ZodValidationPipe(CliConnectionProviderSchema))
    provider: CliConnectionProvider
  ) {
    return ProviderConnectionTargetResponseSchema.parse(await this.connections.target(provider));
  }
  @Post('deauth-claude') @HttpCode(200) async deauthClaude(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return ProviderDisconnectResponseSchema.parse(
      await this.connections.disconnect('claude', body)
    );
  }
  @Get('credential-target') async credentialTarget(
    @Query('provider', new ZodValidationPipe(SetupQueryValueSchema)) provider: string
  ) {
    return SetupCredentialTargetResponseSchema.parse(await this.credentials.target(provider));
  }
  @Post('store-api-key') @HttpCode(200) async storeApiKey(
    @Body(new ZodValidationPipe(SetupCredentialStoreRequestSchema))
    body: SetupCredentialStoreRequest,
    @ClientIdentity() client: ClientIdentityContext
  ) {
    return SetupCredentialMutationResponseSchema.parse(
      await this.credentials.change('store', body, client.clientId)
    );
  }
  @Post('delete-api-key') @HttpCode(200) async deleteApiKey(
    @Body(new ZodValidationPipe(SetupCredentialDeleteRequestSchema))
    body: SetupCredentialDeleteRequest,
    @ClientIdentity() client: ClientIdentityContext
  ) {
    return SetupCredentialMutationResponseSchema.parse(
      await this.credentials.change('delete', body, client.clientId)
    );
  }
  @Get('api-keys') async apiKeys() {
    return SetupKeyPresenceResponseSchema.parse(await this.hostStatus.apiKeys());
  }
  @Get('platform') async platform() {
    return SetupPlatformResponseSchema.parse(await this.hostStatus.platform());
  }
  @Get('claude-verification-target') async claudeVerificationTarget(
    @Query('authMethod', new ZodValidationPipe(SetupQueryValueSchema)) authMethod: string
  ) {
    return ClaudeVerificationTargetResponseSchema.parse(await this.verification.target(authMethod));
  }
  @Post('verify-claude-auth') @HttpCode(200) async verifyClaudeAuth(
    @Body(new ZodValidationPipe(ClaudeVerificationRequestSchema)) body: ClaudeVerificationRequest,
    @ClientIdentity() client: ClientIdentityContext
  ) {
    return ClaudeVerificationResponseSchema.parse(
      await this.verification.verify(body, client.clientId)
    );
  }
  @Get('codex-verification-target') async codexVerificationTarget(
    @Query('authMethod', new ZodValidationPipe(SetupQueryValueSchema)) authMethod: string
  ) {
    return CodexVerificationTargetResponseSchema.parse(
      await this.codexVerification.target(authMethod)
    );
  }
  @Post('verify-codex-auth') @HttpCode(200) async verifyCodexAuth(
    @Body(new ZodValidationPipe(CodexVerificationRequestSchema)) body: CodexVerificationRequest,
    @ClientIdentity() client: ClientIdentityContext
  ) {
    return CodexVerificationResponseSchema.parse(
      await this.codexVerification.verify(body, client.clientId)
    );
  }
  @Get('gh-status') async ghStatus() {
    return SetupGithubStatusResponseSchema.parse(await this.hostStatus.github());
  }
  @Get('github-authentication-target') async githubAuthenticationTarget() {
    return GithubAuthenticationTargetResponseSchema.parse(await this.githubAuthentication.target());
  }
  @Post('verify-github-auth') @HttpCode(200) async verifyGithubAuth(
    @Body(new ZodValidationPipe(GithubAuthenticationRequestSchema))
    body: GithubAuthenticationRequest,
    @ClientIdentity() client: ClientIdentityContext
  ) {
    return GithubAuthenticationResponseSchema.parse(
      await this.githubAuthentication.verify(body, client.clientId)
    );
  }
  @Get('cursor-status') async cursorStatus() {
    return CursorSetupStatusSchema.parse(await this.statuses.status('cursor'));
  }
  @Post('auth-cursor') @HttpCode(200) async authCursor(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return ProviderReconnectResponseSchema.parse(await this.connections.reconnect('cursor', body));
  }
  @Post('deauth-cursor') @HttpCode(200) async deauthCursor(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return ProviderDisconnectResponseSchema.parse(
      await this.connections.disconnect('cursor', body)
    );
  }
  @Get('codex-status') async codexStatus() {
    return SetupInstallationStatusResponseSchema.parse(
      await this.hostStatus.installationStatus('codex')
    );
  }
  @Post('install-codex') @HttpCode(200) async installCodex() {
    return ProviderInstallGuidanceSchema.parse(await this.installation.instructions('codex'));
  }
  @Post('auth-codex') @HttpCode(200) async authCodex(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return ProviderReconnectResponseSchema.parse(await this.connections.reconnect('codex', body));
  }
  @Post('deauth-codex') @HttpCode(200) async deauthCodex(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return ProviderDisconnectResponseSchema.parse(await this.connections.disconnect('codex', body));
  }
  @Get('opencode-status') async opencodeStatus() {
    return SetupInstallationStatusResponseSchema.parse(
      await this.hostStatus.installationStatus('opencode')
    );
  }
  @Post('auth-opencode') @HttpCode(200) async authOpencode(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return ProviderReconnectResponseSchema.parse(
      await this.connections.reconnect('opencode', body)
    );
  }
  @Post('deauth-opencode') @HttpCode(200) async deauthOpencode(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return ProviderDisconnectResponseSchema.parse(
      await this.connections.disconnect('opencode', body)
    );
  }
  @Get('gemini-status') async geminiStatus() {
    return GeminiSetupStatusSchema.parse(await this.statuses.status('gemini'));
  }
  @Post('auth-gemini') @HttpCode(200) async authGemini(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return ProviderReconnectResponseSchema.parse(await this.connections.reconnect('gemini', body));
  }
  @Post('deauth-gemini') @HttpCode(200) async deauthGemini(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return ProviderDisconnectResponseSchema.parse(
      await this.connections.disconnect('gemini', body)
    );
  }
  @Get('copilot-status') async copilotStatus() {
    return CopilotSetupStatusSchema.parse(await this.statuses.status('copilot'));
  }
  @Post('auth-copilot') @HttpCode(200) async authCopilot(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return ProviderReconnectResponseSchema.parse(await this.connections.reconnect('copilot', body));
  }
  @Post('deauth-copilot') @HttpCode(200) async deauthCopilot(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return ProviderDisconnectResponseSchema.parse(
      await this.connections.disconnect('copilot', body)
    );
  }
  @Get('copilot/models') async copilotModels(
    @Query('refresh', new ZodValidationPipe(ProviderRefreshQuerySchema))
    refresh: string | string[] | undefined
  ) {
    return SetupModelsResponseSchema.parse(
      await this.catalogs.models('copilot', refresh === 'true')
    );
  }
  @Post('copilot/models/refresh') @HttpCode(200) async refreshCopilotModels() {
    return SetupModelsResponseSchema.parse(await this.catalogs.models('copilot', true));
  }
  @Post('copilot/cache/clear') @HttpCode(200) async clearCopilotCache() {
    return SetupCacheClearResponseSchema.parse(await this.catalogs.clear('copilot'));
  }
  @Get('opencode/models') async opencodeModels(
    @Query('refresh', new ZodValidationPipe(ProviderRefreshQuerySchema))
    refresh: string | string[] | undefined
  ) {
    return SetupModelsResponseSchema.parse(
      await this.catalogs.models('opencode', refresh === 'true')
    );
  }
  @Post('opencode/models/refresh') @HttpCode(200) async refreshOpencodeModels() {
    return SetupModelsResponseSchema.parse(await this.catalogs.models('opencode', true));
  }
  @Get('opencode/providers') async opencodeProviders() {
    return SetupAuthenticatedProvidersResponseSchema.parse(
      await this.catalogs.authenticatedProviders()
    );
  }
  @Post('opencode/cache/clear') @HttpCode(200) async clearOpencodeCache() {
    return SetupCacheClearResponseSchema.parse(await this.catalogs.clear('opencode'));
  }
  @Get('cursor-config/target') async cursorConfigTarget(
    @Query('projectPath', new ZodValidationPipe(SetupQueryValueSchema)) projectPath: string
  ) {
    return CursorModelConfigTargetResponseSchema.parse(await this.modelConfig.target(projectPath));
  }
  @Get('cursor-config') async cursorConfig(
    @Query('projectPath', new ZodValidationPipe(SetupQueryValueSchema)) projectPath: string
  ) {
    return CursorModelConfigResponseSchema.parse(await this.modelConfig.read(projectPath));
  }
  @Post('cursor-config/default-model') @HttpCode(200) async setCursorDefaultModel(
    @Body(new ZodValidationPipe(CursorDefaultModelRequestSchema)) body: CursorDefaultModelRequest
  ) {
    return CursorDefaultModelResponseSchema.parse(await this.modelConfig.setDefaultModel(body));
  }
  @Post('cursor-config/models') @HttpCode(200) async setCursorModels(
    @Body(new ZodValidationPipe(CursorEnabledModelsRequestSchema)) body: CursorEnabledModelsRequest
  ) {
    return CursorEnabledModelsResponseSchema.parse(await this.modelConfig.setEnabledModels(body));
  }
  @Get('cursor-permissions/target') async cursorPermissionsTarget(
    @Query('scope', new ZodValidationPipe(SetupQueryValueSchema)) scope: string,
    @Query('projectPath', new ZodValidationPipe(SetupQueryValueSchema)) projectPath?: string
  ) {
    return CursorPermissionsTargetResponseSchema.parse(
      await this.permissions.target(scope, projectPath)
    );
  }
  @Get('cursor-permissions') async cursorPermissions(
    @Query('projectPath', new ZodValidationPipe(SetupQueryValueSchema)) projectPath?: string
  ) {
    return SetupCursorPermissionsReadResponseSchema.parse(await this.permissions.read(projectPath));
  }
  @Post('cursor-permissions/profile') @HttpCode(200) async applyPermissionProfile(
    @Body(new ZodValidationPipe(CursorProfileRequestSchema)) body: CursorProfileRequest
  ) {
    return CursorPermissionsMutationResponseSchema.parse(await this.permissions.apply(body));
  }
  @Post('cursor-permissions/custom') @HttpCode(200) async setCustomPermissions(
    @Body(new ZodValidationPipe(CursorCustomPermissionsRequestSchema))
    body: CursorCustomPermissionsRequest
  ) {
    return CursorPermissionsMutationResponseSchema.parse(await this.permissions.custom(body));
  }
  @Delete('cursor-permissions') async deleteProjectPermissions(
    @Body(new ZodValidationPipe(CursorDeletePermissionsRequestSchema))
    body: CursorDeletePermissionsRequest
  ) {
    return CursorPermissionsMutationResponseSchema.parse(await this.permissions.delete(body));
  }
  @Get('cursor-permissions/example') async exampleCursorConfig(
    @Query('profileId', new ZodValidationPipe(SetupQueryValueSchema)) profileId?: string
  ) {
    return SetupCursorPermissionsExampleResponseSchema.parse(
      await this.permissions.example(profileId)
    );
  }
}
