import type { RequestHandler } from 'express';
import { parseRuntimeConfig } from '../../src/core/config/index.js';
import { AuthService } from '../../src/core/auth/auth.service.js';
import { AuthStateRepository } from '../../src/core/auth/auth-state.repository.js';

/** Explicit auth composition for legacy transport acceptance; no production singleton. */
export async function createTestAuth(dataDirectory: string, environment: NodeJS.ProcessEnv = {}) {
  const config = parseRuntimeConfig({ ...environment, DATA_DIR: dataDirectory });
  const state = new AuthStateRepository(config);
  await state.onModuleInit();
  const auth = new AuthService(config, state);
  const middleware: RequestHandler = (request, response, next) => {
    if (config.auth.disabled) return next();
    const result = auth.authenticateRequest(request);
    if (result.authenticated) return next();
    response.status(result.errorType === 'no_auth' ? 401 : 403).json({
      success: false,
      error:
        result.errorType === 'no_auth'
          ? 'Authentication required.'
          : result.errorType === 'invalid_api_key'
            ? 'Invalid API key.'
            : 'Invalid or expired session token.',
    });
  };
  return {
    auth,
    state,
    middleware,
    async close() {
      auth.onApplicationShutdown();
      await state.onApplicationShutdown();
    },
  };
}
