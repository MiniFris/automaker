/**
 * Copilot Connection Service
 *
 * Handles the connection and disconnection of Copilot CLI to the app.
 * Uses a marker file to track the disconnected state.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger } from '@automaker/utils';
import { COPILOT_DISCONNECTED_MARKER_FILE } from '../routes/setup/common.js';

const logger = createLogger('CopilotConnectionService');

/**
 * Get the path to the disconnected marker file
 */
function getMarkerPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  const automakerDir = path.join(root, '.automaker');
  return path.join(automakerDir, COPILOT_DISCONNECTED_MARKER_FILE);
}

/**
 * Connect Copilot CLI to the app by removing the disconnected marker
 *
 * @param projectRoot - Optional project root directory (defaults to cwd)
 * @returns Promise that resolves when the connection is established
 */
export async function connectCopilot(projectRoot?: string): Promise<void> {
  const markerPath = getMarkerPath(projectRoot);

  try {
    await fs.unlink(markerPath);
    logger.info('Copilot CLI connected to app (marker removed)');
  } catch (error) {
    // File doesn't exist - that's fine, Copilot is already connected
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error('Failed to remove disconnected marker:', error);
      throw error;
    }
    logger.debug('Copilot already connected (no marker file found)');
  }
}
