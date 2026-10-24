/**
 * POST /store-api-key endpoint - Store API key
 */

import type { Request, Response } from 'express';
import { persistApiKeyToEnv, getErrorMessage, logError } from '../common.js';
import type { SetupCredentialCache } from '../../../modules/providers/setup-credential-cache.service.js';
import { createLogger } from '@automaker/utils';

const logger = createLogger('Setup');

export function createStoreApiKeyHandler(keys: SetupCredentialCache) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider, apiKey } = req.body as {
        provider: string;
        apiKey: string;
      };

      if (!provider || !apiKey) {
        res.status(400).json({ success: false, error: 'provider and apiKey required' });
        return;
      }

      const providerEnvMap: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        anthropic_oauth_token: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
      };
      const envKey = providerEnvMap[provider];
      if (!envKey) {
        res.status(400).json({
          success: false,
          error: `Unsupported provider: ${provider}. Only anthropic and openai are supported.`,
        });
        return;
      }

      keys.set(provider, apiKey);
      process.env[envKey] = apiKey;
      keys.setEnvironmentConfigured(envKey, true);
      await persistApiKeyToEnv(envKey, apiKey);
      logger.info(`[Setup] Stored API key as ${envKey}`);

      res.json({ success: true });
    } catch (error) {
      logError(error, 'Store API key failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
