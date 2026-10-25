import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import { legacyPreviewPolicy } from './preview-policy.compat.js';
export { PREVIEW_BOOTSTRAP } from '../../core/config/preview-policy.js';

/** Legacy standalone exports. Native policy lives in core/config and is injected explicitly. */
export const PREVIEW_PORT_FIRST = legacyPreviewPolicy().config.firstPort;
export const PREVIEW_PORT_LAST = legacyPreviewPolicy().config.lastPort;
export function previewOrigin(port: number) {
  return legacyPreviewPolicy().origin(port);
}
export function isPreviewApiRequest(request: Pick<IncomingMessage, 'headers'>) {
  return legacyPreviewPolicy().isApiRequest(request);
}
export function previewApiGuard(req: Request, res: Response, next: NextFunction) {
  return legacyPreviewPolicy().apiGuard(req, res, next);
}
