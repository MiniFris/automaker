/**
 * GET /available endpoint - Get available models from all providers
 */

import type { Request, Response } from 'express';
import { ProviderFactory } from '../../../providers/provider-factory.js';
import { getErrorMessage, logError } from '../common.js';
import type { SettingsService } from '../../../services/settings-service.js';
import { toDirectModelId } from '@automaker/types';

export function createAvailableHandler(settingsService?: SettingsService) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      // Get all models from all registered providers (Claude + Cursor)
      const models = ProviderFactory.getAllAvailableModels();
      const global = await settingsService?.getGlobalSettings();
      for (const endpoint of global?.openaiCompatibleEndpoints ?? []) {
        if (!endpoint.enabled || endpoint.protocol !== 'chat-completions') continue;
        for (const model of endpoint.models)
          models.push({
            id: toDirectModelId(model.id),
            modelString: toDirectModelId(model.id),
            providerId: endpoint.id,
            name: model.displayName,
            provider: 'openai-compatible',
            description: endpoint.name,
            supportsTools: model.capabilities.tools,
            supportsVision: false,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
          });
      }

      res.json({ success: true, models });
    } catch (error) {
      logError(error, 'Get available models failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
