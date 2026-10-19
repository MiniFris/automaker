/**
 * Models routes - HTTP API for model providers and availability
 */

import { Router } from 'express';
import { createAvailableHandler } from './routes/available.js';
import { createProvidersHandler } from './routes/providers.js';
import type { SettingsService } from '../../services/settings-service.js';

export function createModelsRoutes(settingsService?: SettingsService): Router {
  const router = Router();

  router.get('/available', createAvailableHandler(settingsService));
  router.get('/providers', createProvidersHandler(settingsService));

  return router;
}
