import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  CliConnectionProviderSchema,
  ProviderDisconnectRequestSchema,
  ProviderReconnectRequestSchema,
  type CliConnectionProvider,
  type ProviderDisconnectRequest,
  type ProviderReconnectRequest,
} from '@automaker/contracts';
import type { Request, Response } from 'express';

import { Public } from '../../core/auth/index.js';
import { SetupHandlersService, type SetupHandlerName } from './setup-handlers.service.js';
import { ProviderSetupStatusService } from './provider-setup-status.service.js';
import { ProviderModelCatalogService } from './provider-model-catalog.service.js';
import { HostSetupStatusService } from './host-setup-status.service.js';
import { ProviderConnectionCommandService } from './provider-connection-command.service.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';

@Public()
@Controller('setup')
export class SetupController {
  constructor(
    @Inject(SetupHandlersService) private readonly handlers: SetupHandlersService,
    @Inject(ProviderSetupStatusService) private readonly statuses: ProviderSetupStatusService,
    @Inject(ProviderModelCatalogService) private readonly catalogs: ProviderModelCatalogService,
    @Inject(HostSetupStatusService) private readonly hostStatus: HostSetupStatusService,
    @Inject(ProviderConnectionCommandService)
    private readonly connections: ProviderConnectionCommandService
  ) {}

  private run(name: SetupHandlerName, request: Request, response: Response) {
    // Express handlers historically defaulted to 200; Nest POST defaults to 201.
    // Individual handlers may still replace this with an explicit error status.
    response.status(200);
    return this.handlers.run(name, request, response);
  }

  @Get('claude-status') claudeStatus() {
    return this.hostStatus.claude();
  }
  @Post('install-claude') installClaude(@Req() q: Request, @Res() s: Response) {
    return this.run('installClaude', q, s);
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
  @Post('store-api-key') storeApiKey(@Req() q: Request, @Res() s: Response) {
    return this.run('storeApiKey', q, s);
  }
  @Post('delete-api-key') deleteApiKey(@Req() q: Request, @Res() s: Response) {
    return this.run('deleteApiKey', q, s);
  }
  @Get('api-keys') apiKeys() {
    return this.hostStatus.apiKeys();
  }
  @Get('platform') platform() {
    return this.hostStatus.platform();
  }
  @Post('verify-claude-auth') verifyClaudeAuth(@Req() q: Request, @Res() s: Response) {
    return this.run('verifyClaudeAuth', q, s);
  }
  @Post('verify-codex-auth') verifyCodexAuth(@Req() q: Request, @Res() s: Response) {
    return this.run('verifyCodexAuth', q, s);
  }
  @Get('gh-status') ghStatus() {
    return this.hostStatus.github();
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
    return this.statuses.installationStatus('codex');
  }
  @Post('install-codex') installCodex(@Req() q: Request, @Res() s: Response) {
    return this.run('installCodex', q, s);
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
    return this.statuses.installationStatus('opencode');
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
  @Get('cursor-config') cursorConfig(@Req() q: Request, @Res() s: Response) {
    return this.run('cursorConfig', q, s);
  }
  @Post('cursor-config/default-model') setCursorDefaultModel(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('setCursorDefaultModel', q, s);
  }
  @Post('cursor-config/models') setCursorModels(@Req() q: Request, @Res() s: Response) {
    return this.run('setCursorModels', q, s);
  }
  @Get('cursor-permissions') cursorPermissions(@Req() q: Request, @Res() s: Response) {
    return this.run('cursorPermissions', q, s);
  }
  @Post('cursor-permissions/profile') applyPermissionProfile(
    @Req() q: Request,
    @Res() s: Response
  ) {
    return this.run('applyPermissionProfile', q, s);
  }
  @Post('cursor-permissions/custom') setCustomPermissions(@Req() q: Request, @Res() s: Response) {
    return this.run('setCustomPermissions', q, s);
  }
  @Delete('cursor-permissions') deleteProjectPermissions(@Req() q: Request, @Res() s: Response) {
    return this.run('deleteProjectPermissions', q, s);
  }
  @Get('cursor-permissions/example') exampleCursorConfig(@Req() q: Request, @Res() s: Response) {
    return this.run('exampleCursorConfig', q, s);
  }
}
