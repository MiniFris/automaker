import { Controller, Delete, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../core/auth/index.js';
import { SetupHandlersService, type SetupHandlerName } from './setup-handlers.service.js';
import { ProviderSetupStatusService } from './provider-setup-status.service.js';
import { ProviderModelCatalogService } from './provider-model-catalog.service.js';

@Public()
@Controller('setup')
export class SetupController {
  constructor(
    @Inject(SetupHandlersService) private readonly handlers: SetupHandlersService,
    @Inject(ProviderSetupStatusService) private readonly statuses: ProviderSetupStatusService,
    @Inject(ProviderModelCatalogService) private readonly catalogs: ProviderModelCatalogService
  ) {}

  private run(name: SetupHandlerName, request: Request, response: Response) {
    // Express handlers historically defaulted to 200; Nest POST defaults to 201.
    // Individual handlers may still replace this with an explicit error status.
    response.status(200);
    return this.handlers.run(name, request, response);
  }

  @Get('claude-status') claudeStatus(@Req() q: Request, @Res() s: Response) {
    return this.run('claudeStatus', q, s);
  }
  @Post('install-claude') installClaude(@Req() q: Request, @Res() s: Response) {
    return this.run('installClaude', q, s);
  }
  @Post('auth-claude') authClaude(@Req() q: Request, @Res() s: Response) {
    return this.run('authClaude', q, s);
  }
  @Post('deauth-claude') deauthClaude(@Req() q: Request, @Res() s: Response) {
    return this.run('deauthClaude', q, s);
  }
  @Post('store-api-key') storeApiKey(@Req() q: Request, @Res() s: Response) {
    return this.run('storeApiKey', q, s);
  }
  @Post('delete-api-key') deleteApiKey(@Req() q: Request, @Res() s: Response) {
    return this.run('deleteApiKey', q, s);
  }
  @Get('api-keys') apiKeys(@Req() q: Request, @Res() s: Response) {
    return this.run('apiKeys', q, s);
  }
  @Get('platform') platform(@Req() q: Request, @Res() s: Response) {
    return this.run('platform', q, s);
  }
  @Post('verify-claude-auth') verifyClaudeAuth(@Req() q: Request, @Res() s: Response) {
    return this.run('verifyClaudeAuth', q, s);
  }
  @Post('verify-codex-auth') verifyCodexAuth(@Req() q: Request, @Res() s: Response) {
    return this.run('verifyCodexAuth', q, s);
  }
  @Get('gh-status') ghStatus(@Req() q: Request, @Res() s: Response) {
    return this.run('ghStatus', q, s);
  }
  @Get('cursor-status') cursorStatus() {
    return this.statuses.status('cursor');
  }
  @Post('auth-cursor') authCursor(@Req() q: Request, @Res() s: Response) {
    return this.run('authCursor', q, s);
  }
  @Post('deauth-cursor') deauthCursor(@Req() q: Request, @Res() s: Response) {
    return this.run('deauthCursor', q, s);
  }
  @Get('codex-status') codexStatus() {
    return this.statuses.installationStatus('codex');
  }
  @Post('install-codex') installCodex(@Req() q: Request, @Res() s: Response) {
    return this.run('installCodex', q, s);
  }
  @Post('auth-codex') authCodex(@Req() q: Request, @Res() s: Response) {
    return this.run('authCodex', q, s);
  }
  @Post('deauth-codex') deauthCodex(@Req() q: Request, @Res() s: Response) {
    return this.run('deauthCodex', q, s);
  }
  @Get('opencode-status') opencodeStatus() {
    return this.statuses.installationStatus('opencode');
  }
  @Post('auth-opencode') authOpencode(@Req() q: Request, @Res() s: Response) {
    return this.run('authOpencode', q, s);
  }
  @Post('deauth-opencode') deauthOpencode(@Req() q: Request, @Res() s: Response) {
    return this.run('deauthOpencode', q, s);
  }
  @Get('gemini-status') geminiStatus() {
    return this.statuses.status('gemini');
  }
  @Post('auth-gemini') authGemini(@Req() q: Request, @Res() s: Response) {
    return this.run('authGemini', q, s);
  }
  @Post('deauth-gemini') deauthGemini(@Req() q: Request, @Res() s: Response) {
    return this.run('deauthGemini', q, s);
  }
  @Get('copilot-status') copilotStatus() {
    return this.statuses.status('copilot');
  }
  @Post('auth-copilot') authCopilot(@Req() q: Request, @Res() s: Response) {
    return this.run('authCopilot', q, s);
  }
  @Post('deauth-copilot') deauthCopilot(@Req() q: Request, @Res() s: Response) {
    return this.run('deauthCopilot', q, s);
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
