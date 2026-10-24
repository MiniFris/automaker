import { Inject, Injectable } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';

import { createApiKeysHandler } from '../../routes/setup/routes/api-keys.js';
import { createAuthClaudeHandler } from '../../routes/setup/routes/auth-claude.js';
import { createAuthCodexHandler } from '../../routes/setup/routes/auth-codex.js';
import { createAuthCopilotHandler } from '../../routes/setup/routes/auth-copilot.js';
import { createAuthCursorHandler } from '../../routes/setup/routes/auth-cursor.js';
import { createAuthGeminiHandler } from '../../routes/setup/routes/auth-gemini.js';
import { createAuthOpencodeHandler } from '../../routes/setup/routes/auth-opencode.js';
import { createClaudeStatusHandler } from '../../routes/setup/routes/claude-status.js';
import { createCodexStatusHandler } from '../../routes/setup/routes/codex-status.js';
import {
  createClearCopilotCacheHandler,
  createGetCopilotModelsHandler,
  createRefreshCopilotModelsHandler,
} from '../../routes/setup/routes/copilot-models.js';
import {
  createApplyPermissionProfileHandler,
  createDeleteProjectPermissionsHandler,
  createGetCursorConfigHandler,
  createGetCursorPermissionsHandler,
  createGetExampleConfigHandler,
  createSetCursorDefaultModelHandler,
  createSetCursorModelsHandler,
  createSetCustomPermissionsHandler,
} from '../../routes/setup/routes/cursor-config.js';
import { createDeauthClaudeHandler } from '../../routes/setup/routes/deauth-claude.js';
import { createDeauthCodexHandler } from '../../routes/setup/routes/deauth-codex.js';
import { createDeauthCopilotHandler } from '../../routes/setup/routes/deauth-copilot.js';
import { createDeauthCursorHandler } from '../../routes/setup/routes/deauth-cursor.js';
import { createDeauthGeminiHandler } from '../../routes/setup/routes/deauth-gemini.js';
import { createDeauthOpencodeHandler } from '../../routes/setup/routes/deauth-opencode.js';
import { createDeleteApiKeyHandler } from '../../routes/setup/routes/delete-api-key.js';
import { createGhStatusHandler } from '../../routes/setup/routes/gh-status.js';
import { createInstallClaudeHandler } from '../../routes/setup/routes/install-claude.js';
import { createInstallCodexHandler } from '../../routes/setup/routes/install-codex.js';
import {
  createClearOpencodeCacheHandler,
  createGetOpencodeModelsHandler,
  createGetOpencodeProvidersHandler,
  createRefreshOpencodeModelsHandler,
} from '../../routes/setup/routes/opencode-models.js';
import { createOpencodeStatusHandler } from '../../routes/setup/routes/opencode-status.js';
import { createPlatformHandler } from '../../routes/setup/routes/platform.js';
import { createStoreApiKeyHandler } from '../../routes/setup/routes/store-api-key.js';
import { createVerifyClaudeAuthHandler } from '../../routes/setup/routes/verify-claude-auth.js';
import { createVerifyCodexAuthHandler } from '../../routes/setup/routes/verify-codex-auth.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderRegistry } from './provider-registry.service.js';

export type SetupHandlerName = keyof ReturnType<SetupHandlersService['createHandlers']>;

/**
 * Compatibility boundary for setup operations while their CLI implementations are
 * moved behind provider adapters. HTTP ownership and dependency composition live in Nest.
 */
@Injectable()
export class SetupHandlersService {
  private readonly handlers: Record<string, RequestHandler>;

  constructor(
    @Inject(SettingsService) settings: SettingsService,
    @Inject(ProviderRegistry) providers: ProviderRegistry
  ) {
    this.handlers = this.createHandlers(settings, providers);
  }

  run(name: SetupHandlerName, request: Request, response: Response): Promise<void> {
    const handler = this.handlers[name];
    return Promise.resolve(
      handler(request, response, (error?: unknown) => {
        if (error) throw error;
      }) as void | Promise<void>
    );
  }

  private createHandlers(settings: SettingsService, providers: ProviderRegistry) {
    return {
      claudeStatus: createClaudeStatusHandler(),
      installClaude: createInstallClaudeHandler(),
      authClaude: createAuthClaudeHandler(),
      deauthClaude: createDeauthClaudeHandler(),
      storeApiKey: createStoreApiKeyHandler(),
      deleteApiKey: createDeleteApiKeyHandler(),
      apiKeys: createApiKeysHandler(),
      platform: createPlatformHandler(),
      verifyClaudeAuth: createVerifyClaudeAuthHandler(settings),
      verifyCodexAuth: createVerifyCodexAuthHandler(settings, providers),
      ghStatus: createGhStatusHandler(),
      authCursor: createAuthCursorHandler(),
      deauthCursor: createDeauthCursorHandler(),
      codexStatus: createCodexStatusHandler(settings),
      installCodex: createInstallCodexHandler(),
      authCodex: createAuthCodexHandler(),
      deauthCodex: createDeauthCodexHandler(),
      opencodeStatus: createOpencodeStatusHandler(),
      authOpencode: createAuthOpencodeHandler(),
      deauthOpencode: createDeauthOpencodeHandler(),
      authGemini: createAuthGeminiHandler(),
      deauthGemini: createDeauthGeminiHandler(),
      authCopilot: createAuthCopilotHandler(),
      deauthCopilot: createDeauthCopilotHandler(),
      copilotModels: createGetCopilotModelsHandler(),
      refreshCopilotModels: createRefreshCopilotModelsHandler(),
      clearCopilotCache: createClearCopilotCacheHandler(),
      opencodeModels: createGetOpencodeModelsHandler(),
      refreshOpencodeModels: createRefreshOpencodeModelsHandler(),
      opencodeProviders: createGetOpencodeProvidersHandler(),
      clearOpencodeCache: createClearOpencodeCacheHandler(),
      cursorConfig: createGetCursorConfigHandler(),
      setCursorDefaultModel: createSetCursorDefaultModelHandler(),
      setCursorModels: createSetCursorModelsHandler(),
      cursorPermissions: createGetCursorPermissionsHandler(),
      applyPermissionProfile: createApplyPermissionProfileHandler(),
      setCustomPermissions: createSetCustomPermissionsHandler(),
      deleteProjectPermissions: createDeleteProjectPermissionsHandler(),
      exampleCursorConfig: createGetExampleConfigHandler(),
    } satisfies Record<string, RequestHandler>;
  }
}
