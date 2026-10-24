/**
 * Cursor CLI configuration routes
 *
 * Provides endpoints for managing Cursor CLI configuration:
 * - GET /api/setup/cursor-config - Get current configuration
 * - POST /api/setup/cursor-config/default-model - Set default model
 * - POST /api/setup/cursor-config/models - Set enabled models
 *
 * Permissions endpoints are owned by native CursorPermissionsService.
 */

import type { Request, Response } from 'express';
import path from 'path';
import { CursorConfigManager } from '../../../providers/cursor-config-manager.js';
import { CURSOR_MODEL_MAP, type CursorModelId } from '@automaker/types';
import { getErrorMessage, logError } from '../common.js';

/**
 * Validate that a project path is safe (no path traversal)
 * @throws Error if path contains traversal sequences
 */
function validateProjectPath(projectPath: string): void {
  // Resolve to absolute path and check for traversal
  const resolved = path.resolve(projectPath);
  const normalized = path.normalize(projectPath);

  // Check for obvious traversal attempts
  if (normalized.includes('..') || projectPath.includes('..')) {
    throw new Error('Invalid project path: path traversal not allowed');
  }

  // Ensure the resolved path doesn't escape intended boundaries
  // by checking if it starts with the normalized path components
  if (!resolved.startsWith(path.resolve(normalized))) {
    throw new Error('Invalid project path: path traversal detected');
  }
}

/**
 * Creates handler for GET /api/setup/cursor-config
 * Returns current Cursor configuration and available models
 */
export function createGetCursorConfigHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const projectPath = req.query.projectPath as string;

      if (!projectPath) {
        res.status(400).json({
          success: false,
          error: 'projectPath query parameter is required',
        });
        return;
      }

      // Validate path to prevent traversal attacks
      validateProjectPath(projectPath);

      const configManager = new CursorConfigManager(projectPath);

      res.json({
        success: true,
        config: configManager.getConfig(),
        availableModels: Object.values(CURSOR_MODEL_MAP),
      });
    } catch (error) {
      logError(error, 'Get Cursor config failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}

/**
 * Creates handler for POST /api/setup/cursor-config/default-model
 * Sets the default Cursor model
 */
export function createSetCursorDefaultModelHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { model, projectPath } = req.body;

      if (!projectPath) {
        res.status(400).json({
          success: false,
          error: 'projectPath is required',
        });
        return;
      }

      // Validate path to prevent traversal attacks
      validateProjectPath(projectPath);

      if (!model || !(model in CURSOR_MODEL_MAP)) {
        res.status(400).json({
          success: false,
          error: `Invalid model ID. Valid models: ${Object.keys(CURSOR_MODEL_MAP).join(', ')}`,
        });
        return;
      }

      const configManager = new CursorConfigManager(projectPath);
      configManager.setDefaultModel(model as CursorModelId);

      res.json({ success: true, model });
    } catch (error) {
      logError(error, 'Set Cursor default model failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}

/**
 * Creates handler for POST /api/setup/cursor-config/models
 * Sets the enabled Cursor models list
 */
export function createSetCursorModelsHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { models, projectPath } = req.body;

      if (!projectPath) {
        res.status(400).json({
          success: false,
          error: 'projectPath is required',
        });
        return;
      }

      // Validate path to prevent traversal attacks
      validateProjectPath(projectPath);

      if (!Array.isArray(models)) {
        res.status(400).json({
          success: false,
          error: 'Models must be an array',
        });
        return;
      }

      // Filter to valid models only
      const validModels = models.filter((m): m is CursorModelId => m in CURSOR_MODEL_MAP);

      if (validModels.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No valid models provided',
        });
        return;
      }

      const configManager = new CursorConfigManager(projectPath);
      configManager.setEnabledModels(validModels);

      res.json({ success: true, models: validModels });
    } catch (error) {
      logError(error, 'Set Cursor models failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}
