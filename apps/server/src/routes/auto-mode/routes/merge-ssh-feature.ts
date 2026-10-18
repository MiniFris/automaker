import type { Request, Response } from 'express';
import type { AutoModeServiceCompat } from '../../../services/auto-mode/index.js';
import { getErrorMessage } from '../common.js';

export function createMergeSSHFeatureHandler(service: AutoModeServiceCompat, common = false) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['projectPath', 'featureId', 'accepted'].includes(key)) ||
      typeof body.projectPath !== 'string' ||
      typeof body.featureId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(body.featureId) ||
      body.accepted !== true
    ) {
      res.status(400).json({
        success: false,
        error:
          'projectPath, featureId and explicit accepted:true are required for remote fast-forward merge.',
      });
      return;
    }
    try {
      if (common) await service.mergeEnvironmentFeature(body.projectPath, body.featureId);
      else await service.mergeSSHFeature(body.projectPath, body.featureId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
