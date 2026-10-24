import { Inject, Injectable } from '@nestjs/common';
import type { Request, RequestHandler, Response } from 'express';

import { createDeleteApiKeyHandler } from '../../routes/setup/routes/delete-api-key.js';
import { createStoreApiKeyHandler } from '../../routes/setup/routes/store-api-key.js';
import { SetupCredentialCache } from './setup-credential-cache.service.js';

export type SetupHandlerName = keyof ReturnType<SetupHandlersService['createHandlers']>;

/**
 * Compatibility boundary for setup operations while their CLI implementations are
 * moved behind provider adapters. HTTP ownership and dependency composition live in Nest.
 */
@Injectable()
export class SetupHandlersService {
  private readonly handlers: Record<string, RequestHandler>;

  constructor(@Inject(SetupCredentialCache) keys: SetupCredentialCache) {
    this.handlers = this.createHandlers(keys);
  }

  run(name: SetupHandlerName, request: Request, response: Response): Promise<void> {
    const handler = this.handlers[name];
    return Promise.resolve(
      handler(request, response, (error?: unknown) => {
        if (error) throw error;
      }) as void | Promise<void>
    );
  }

  private createHandlers(keys: SetupCredentialCache) {
    return {
      storeApiKey: createStoreApiKeyHandler(keys),
      deleteApiKey: createDeleteApiKeyHandler(keys),
    } satisfies Record<string, RequestHandler>;
  }
}
