import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
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
import type { Request } from 'express';

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

  @Get('claude-status') claudeStatus() {
    return this.hostStatus.claude();
  }
  @Post('install-claude') @HttpCode(200) installClaude() {
    return this.installation.instructions('claude');
  }
  @Post('auth-claude') @HttpCode(200) authClaude(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return this.connections.reconnect('claude', body);
  }
  @Get('connection-target') connectionTarget(
    @Query('provider', new ZodValidationPipe(CliConnectionProviderSchema))
    provider: CliConnectionProvider
  ) {
    return this.connections.target(provider);
  }
  @Post('deauth-claude') @HttpCode(200) deauthClaude(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return this.connections.disconnect('claude', body);
  }
  @Get('credential-target') credentialTarget(@Query('provider') provider: string) {
    return this.credentials.target(provider);
  }
  @Post('store-api-key') @HttpCode(200) storeApiKey(
    @Body(new ZodValidationPipe(SetupCredentialStoreRequestSchema))
    body: SetupCredentialStoreRequest,
    @Req() request: Request
  ) {
    return this.credentials.change(
      'store',
      body,
      request.ip || request.socket.remoteAddress || 'unknown'
    );
  }
  @Post('delete-api-key') @HttpCode(200) deleteApiKey(
    @Body(new ZodValidationPipe(SetupCredentialDeleteRequestSchema))
    body: SetupCredentialDeleteRequest,
    @Req() request: Request
  ) {
    return this.credentials.change(
      'delete',
      body,
      request.ip || request.socket.remoteAddress || 'unknown'
    );
  }
  @Get('api-keys') apiKeys() {
    return this.hostStatus.apiKeys();
  }
  @Get('platform') platform() {
    return this.hostStatus.platform();
  }
  @Get('claude-verification-target') claudeVerificationTarget(
    @Query('authMethod') authMethod: string
  ) {
    return this.verification.target(authMethod);
  }
  @Post('verify-claude-auth') @HttpCode(200) verifyClaudeAuth(
    @Body(new ZodValidationPipe(ClaudeVerificationRequestSchema)) body: ClaudeVerificationRequest,
    @Req() request: Request
  ) {
    return this.verification.verify(body, request.ip || request.socket.remoteAddress || 'unknown');
  }
  @Get('codex-verification-target') codexVerificationTarget(
    @Query('authMethod') authMethod: string
  ) {
    return this.codexVerification.target(authMethod);
  }
  @Post('verify-codex-auth') @HttpCode(200) verifyCodexAuth(
    @Body(new ZodValidationPipe(CodexVerificationRequestSchema)) body: CodexVerificationRequest,
    @Req() request: Request
  ) {
    return this.codexVerification.verify(
      body,
      request.ip || request.socket.remoteAddress || 'unknown'
    );
  }
  @Get('gh-status') ghStatus() {
    return this.hostStatus.github();
  }
  @Get('github-authentication-target') githubAuthenticationTarget() {
    return this.githubAuthentication.target();
  }
  @Post('verify-github-auth') @HttpCode(200) verifyGithubAuth(
    @Body(new ZodValidationPipe(GithubAuthenticationRequestSchema))
    body: GithubAuthenticationRequest,
    @Req() request: Request
  ) {
    return this.githubAuthentication.verify(
      body,
      request.ip || request.socket.remoteAddress || 'unknown'
    );
  }
  @Get('cursor-status') cursorStatus() {
    return this.statuses.status('cursor');
  }
  @Post('auth-cursor') @HttpCode(200) authCursor(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return this.connections.reconnect('cursor', body);
  }
  @Post('deauth-cursor') @HttpCode(200) deauthCursor(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return this.connections.disconnect('cursor', body);
  }
  @Get('codex-status') codexStatus() {
    return this.hostStatus.installationStatus('codex');
  }
  @Post('install-codex') @HttpCode(200) installCodex() {
    return this.installation.instructions('codex');
  }
  @Post('auth-codex') @HttpCode(200) authCodex(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return this.connections.reconnect('codex', body);
  }
  @Post('deauth-codex') @HttpCode(200) deauthCodex(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return this.connections.disconnect('codex', body);
  }
  @Get('opencode-status') opencodeStatus() {
    return this.hostStatus.installationStatus('opencode');
  }
  @Post('auth-opencode') @HttpCode(200) authOpencode(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return this.connections.reconnect('opencode', body);
  }
  @Post('deauth-opencode') @HttpCode(200) deauthOpencode(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return this.connections.disconnect('opencode', body);
  }
  @Get('gemini-status') geminiStatus() {
    return this.statuses.status('gemini');
  }
  @Post('auth-gemini') @HttpCode(200) authGemini(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return this.connections.reconnect('gemini', body);
  }
  @Post('deauth-gemini') @HttpCode(200) deauthGemini(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return this.connections.disconnect('gemini', body);
  }
  @Get('copilot-status') copilotStatus() {
    return this.statuses.status('copilot');
  }
  @Post('auth-copilot') @HttpCode(200) authCopilot(
    @Body(new ZodValidationPipe(ProviderReconnectRequestSchema)) body: ProviderReconnectRequest
  ) {
    return this.connections.reconnect('copilot', body);
  }
  @Post('deauth-copilot') @HttpCode(200) deauthCopilot(
    @Body(new ZodValidationPipe(ProviderDisconnectRequestSchema)) body: ProviderDisconnectRequest
  ) {
    return this.connections.disconnect('copilot', body);
  }
  @Get('copilot/models') copilotModels(@Query('refresh') refresh: string | undefined) {
    return this.catalogs.models('copilot', refresh === 'true');
  }
  @Post('copilot/models/refresh') @HttpCode(200) refreshCopilotModels() {
    return this.catalogs.models('copilot', true);
  }
  @Post('copilot/cache/clear') @HttpCode(200) clearCopilotCache() {
    return this.catalogs.clear('copilot');
  }
  @Get('opencode/models') opencodeModels(@Query('refresh') refresh: string | undefined) {
    return this.catalogs.models('opencode', refresh === 'true');
  }
  @Post('opencode/models/refresh') @HttpCode(200) refreshOpencodeModels() {
    return this.catalogs.models('opencode', true);
  }
  @Get('opencode/providers') opencodeProviders() {
    return this.catalogs.authenticatedProviders();
  }
  @Post('opencode/cache/clear') @HttpCode(200) clearOpencodeCache() {
    return this.catalogs.clear('opencode');
  }
  @Get('cursor-config/target') cursorConfigTarget(@Query('projectPath') projectPath: string) {
    return this.modelConfig.target(projectPath);
  }
  @Get('cursor-config') cursorConfig(@Query('projectPath') projectPath: string) {
    return this.modelConfig.read(projectPath);
  }
  @Post('cursor-config/default-model') @HttpCode(200) setCursorDefaultModel(
    @Body(new ZodValidationPipe(CursorDefaultModelRequestSchema)) body: CursorDefaultModelRequest
  ) {
    return this.modelConfig.setDefaultModel(body);
  }
  @Post('cursor-config/models') @HttpCode(200) setCursorModels(
    @Body(new ZodValidationPipe(CursorEnabledModelsRequestSchema)) body: CursorEnabledModelsRequest
  ) {
    return this.modelConfig.setEnabledModels(body);
  }
  @Get('cursor-permissions/target') cursorPermissionsTarget(
    @Query('scope') scope: string,
    @Query('projectPath') projectPath?: string
  ) {
    return this.permissions.target(scope, projectPath);
  }
  @Get('cursor-permissions') cursorPermissions(@Query('projectPath') projectPath?: string) {
    return this.permissions.read(projectPath);
  }
  @Post('cursor-permissions/profile') @HttpCode(200) applyPermissionProfile(
    @Body(new ZodValidationPipe(CursorProfileRequestSchema)) body: CursorProfileRequest
  ) {
    return this.permissions.apply(body);
  }
  @Post('cursor-permissions/custom') @HttpCode(200) setCustomPermissions(
    @Body(new ZodValidationPipe(CursorCustomPermissionsRequestSchema))
    body: CursorCustomPermissionsRequest
  ) {
    return this.permissions.custom(body);
  }
  @Delete('cursor-permissions') deleteProjectPermissions(
    @Body(new ZodValidationPipe(CursorDeletePermissionsRequestSchema))
    body: CursorDeletePermissionsRequest
  ) {
    return this.permissions.delete(body);
  }
  @Get('cursor-permissions/example') exampleCursorConfig(@Query('profileId') profileId?: string) {
    return this.permissions.example(profileId);
  }
}
