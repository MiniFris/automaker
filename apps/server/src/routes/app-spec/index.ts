/**
 * Spec Regeneration routes - HTTP API for AI-powered spec generation
 */

import { Router } from 'express';
import type { EventEmitter } from '../../lib/events.js';
import { createCreateHandler } from './routes/create.js';
import { createGenerateHandler } from './routes/generate.js';
import { createGenerateFeaturesHandler } from './routes/generate-features.js';
import { createSyncHandler } from './routes/sync.js';
import { createStopHandler } from './routes/stop.js';
import { createStatusHandler } from './routes/status.js';
import type { SettingsService } from '../../services/settings-service.js';
import type { NotificationService } from '../../services/notification-service.js';

export function createSpecRegenerationRoutes(
  events: EventEmitter,
  settingsService?: SettingsService,
  notificationService?: NotificationService
): Router {
  const router = Router();

  router.post('/create', createCreateHandler(events, settingsService, notificationService));
  router.post('/generate', createGenerateHandler(events, settingsService, notificationService));
  router.post(
    '/generate-features',
    createGenerateFeaturesHandler(events, settingsService, notificationService)
  );
  router.post('/sync', createSyncHandler(events, settingsService, notificationService));
  router.post('/stop', createStopHandler());
  router.get('/status', createStatusHandler());

  return router;
}
