/**
 * Git routes - HTTP API for git operations (non-worktree)
 */

import { Router } from 'express';
import { validatePathParams } from '../../middleware/validate-paths.js';
import { createDiffsHandler } from './routes/diffs.js';
import { createFileDiffHandler } from './routes/file-diff.js';
import { createStageFilesHandler } from './routes/stage-files.js';
import { createDetailsHandler } from './routes/details.js';
import { createEnhancedStatusHandler } from './routes/enhanced-status.js';
import type { SettingsService } from '../../services/settings-service.js';
import { environmentGitDispatcher } from '../environment-git.js';

export function createGitRoutes(
  settings?: SettingsService,
  isProjectBusy?: (projectPath: string) => boolean | Promise<boolean>
): Router {
  const router = Router();
  if (settings) router.use(environmentGitDispatcher(settings, 'git', isProjectBusy));

  router.post('/diffs', validatePathParams('projectPath'), createDiffsHandler());
  router.post('/file-diff', validatePathParams('projectPath', 'filePath'), createFileDiffHandler());
  router.post(
    '/stage-files',
    validatePathParams('projectPath', 'files[]'),
    createStageFilesHandler()
  );
  router.post('/details', validatePathParams('projectPath', 'filePath?'), createDetailsHandler());
  router.post('/enhanced-status', validatePathParams('projectPath'), createEnhancedStatusHandler());

  return router;
}
