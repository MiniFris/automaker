import { Router } from 'express';
import {
  parseModelTimeoutSettings,
  MODEL_TIMEOUT_PROVIDERS,
  PROVIDER_TIMEOUT_KEYS,
  providerModelTimeouts,
  type ModelTimeoutProvider,
} from '@automaker/types';
import type { SettingsService } from '../../services/settings-service.js';

/** A small, secret-free DTO: timeout controls never need to fetch all connection settings. */
export function createModelTimeoutSettingsRoutes(settings: SettingsService): Router {
  const router = Router();
  router.get('/:provider', async (req, res) => {
    const provider = req.params.provider as ModelTimeoutProvider;
    if (!MODEL_TIMEOUT_PROVIDERS.includes(provider)) {
      res.status(400).json({ success: false, error: 'Unknown timeout provider.' });
      return;
    }
    try {
      res.json({
        success: true,
        timeouts: providerModelTimeouts(await settings.getGlobalSettings(), provider),
      });
    } catch {
      res.status(400).json({ success: false, error: 'Provider timeouts could not be read.' });
    }
  });
  router.put('/:provider', async (req, res) => {
    const provider = req.params.provider as ModelTimeoutProvider;
    try {
      if (
        !MODEL_TIMEOUT_PROVIDERS.includes(provider) ||
        !req.body ||
        Object.keys(req.body).some((key) => key !== 'timeouts')
      )
        throw new Error('Invalid provider timeout update.');
      const timeouts = parseModelTimeoutSettings(
        req.body.timeouts,
        PROVIDER_TIMEOUT_KEYS[provider]
      );
      await settings.updateProviderModelTimeouts(provider, timeouts);
      res.json({ success: true, timeouts });
    } catch {
      res.status(400).json({ success: false, error: 'Invalid provider timeout settings.' });
    }
  });
  router.get('/', async (_req, res) => {
    try {
      const global = await settings.getGlobalSettings();
      res.json({ success: true, timeouts: parseModelTimeoutSettings(global.modelTimeouts ?? {}) });
    } catch {
      res.status(400).json({ success: false, error: 'Model timeout settings could not be read.' });
    }
  });
  router.put('/', async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some((key) => key !== 'timeouts'))
        throw new Error('Invalid model timeout update.');
      const timeouts = parseModelTimeoutSettings(req.body.timeouts);
      await settings.updateGlobalSettings({ modelTimeouts: timeouts });
      res.json({ success: true, timeouts });
    } catch {
      res.status(400).json({
        success: false,
        error:
          'Invalid model timeout settings. Use positive integer milliseconds within the supported timer range.',
      });
    }
  });
  return router;
}
