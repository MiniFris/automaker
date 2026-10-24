/**
 * Compatibility tombstone only. No body inspection and no private storage access.
 * The production owner is the native Nest controller.
 */
import type { Request, Response } from 'express';
import { RETIRED_CREDENTIAL_WRITE } from '@automaker/contracts';

export function createUpdateCredentialsHandler() {
  return async (_req: Request, res: Response): Promise<void> => {
    res.status(410).json(RETIRED_CREDENTIAL_WRITE);
  };
}
