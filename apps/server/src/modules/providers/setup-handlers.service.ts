import { Inject, Injectable } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';

import { createAuthClaudeHandler } from '../../routes/setup/routes/auth-claude.js';
import { createAuthCodexHandler } from '../../routes/setup/routes/auth-codex.js';
import { createAuthCopilotHandler } from '../../routes/setup/routes/auth-copilot.js';
import { createAuthCursorHandler } from '../../routes/setup/routes/auth-cursor.js';
import { createAuthGeminiHandler } from '../../routes/setup/routes/auth-gemini.js';
import { createAuthOpencodeHandler } from '../../routes/setup/routes/auth-opencode.js';
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
import { createDeleteApiKeyHandler } from '../../routes/setup/routes/delete-api-key.js';
import { createInstallClaudeHandler } from '../../routes/setup/routes/install-claude.js';
import { createInstallCodexHandler } from '../../routes/setup/routes/install-codex.js';
import { createStoreApiKeyHandler } from '../../routes/setup/routes/store-api-key.js';
import { createVerifyClaudeAuthHandler } from '../../routes/setup/routes/verify-claude-auth.js';
import { createVerifyCodexAuthHandler } from '../../routes/setup/routes/verify-codex-auth.js';
import { SettingsService } from '../../services/settings-service.js';
import { ProviderRegistry } from './provider-registry.service.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';

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
    @Inject(ProviderRegistry) providers: ProviderRegistry,
    @Inject(SetupCredentialCache) keys: SetupCredentialCache
  ) {
    this.handlers = this.createHandlers(settings, providers, keys);
  }

  run(name: SetupHandlerName, request: Request, response: Response): Promise<void> {
    const handler = this.handlers[name];
    return Promise.resolve(
      handler(request, response, (error?: unknown) => {
        if (error) throw error;
      }) as void | Promise<void>
    );
  }

  private createHandlers(
    settings: SettingsService,
    providers: ProviderRegistry,
    keys: SetupCredentialCache
  ) {
    return {
      installClaude: createInstallClaudeHandler(),
      authClaude: createAuthClaudeHandler(),
      storeApiKey: createStoreApiKeyHandler(keys),
      deleteApiKey: createDeleteApiKeyHandler(keys),
      verifyClaudeAuth: createVerifyClaudeAuthHandler(settings, keys),
      verifyCodexAuth: createVerifyCodexAuthHandler(settings, providers, keys),
      authCursor: createAuthCursorHandler(),
      installCodex: createInstallCodexHandler(),
      authCodex: createAuthCodexHandler(),
      authOpencode: createAuthOpencodeHandler(),
      authGemini: createAuthGeminiHandler(),
      authCopilot: createAuthCopilotHandler(),
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
