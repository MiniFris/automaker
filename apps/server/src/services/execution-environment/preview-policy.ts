import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

// Reserved independently of active sessions, so an expired preview origin never becomes API-trusted.
export const PREVIEW_PORT_FIRST = Number.parseInt(
  process.env.AUTOMAKER_PREVIEW_PORT_FIRST ?? '3100',
  10
);
export const PREVIEW_PORT_LAST = Number.parseInt(
  process.env.AUTOMAKER_PREVIEW_PORT_LAST ?? '3119',
  10
);
export const PREVIEW_BOOTSTRAP = '/__automaker_preview';

export function previewOrigin(port: number) {
  const template = process.env.AUTOMAKER_PREVIEW_PUBLIC_URL;
  if (!template) return `http://localhost:${port}`;
  if (!template.includes('{port}'))
    throw new Error('AUTOMAKER_PREVIEW_PUBLIC_URL must contain {port} (port or hostname).');
  const url = new URL(template.replaceAll('{port}', String(port)));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'AUTOMAKER_PREVIEW_PUBLIC_URL must be an HTTP(S) origin template without credentials/path/query/hash.'
    );
  return url.origin;
}

function previewAddress(value: string | undefined) {
  if (!value) return false;
  if (value === 'null') return false;
  try {
    const url = new URL(value);
    if (Number(url.port) >= PREVIEW_PORT_FIRST && Number(url.port) <= PREVIEW_PORT_LAST)
      return true;
    if (process.env.AUTOMAKER_PREVIEW_PUBLIC_URL)
      for (let port = PREVIEW_PORT_FIRST; port <= PREVIEW_PORT_LAST; port++)
        if (url.origin === previewOrigin(port)) return true;
    return false;
  } catch {
    return true;
  } // malformed origins are not a reason to widen access
}

/** CORS alone does not protect cookie-authenticated WebSockets or simple navigation requests. */
export function isPreviewApiRequest(request: Pick<IncomingMessage, 'headers'>) {
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  if (previewAddress(origin) || previewAddress(referer)) return true;
  // Preview may suppress referrers. Normal API fetches send Origin across ports;
  // same-origin nginx API calls remain unchanged. Header-authenticated native clients remain valid.
  const destination = request.headers['sec-fetch-dest'];
  if (origin === 'null' && !request.headers['x-api-key'] && !request.headers['x-session-token'])
    return true;
  return (
    !origin &&
    !referer &&
    ['same-site', 'cross-site'].includes(String(request.headers['sec-fetch-site'])) &&
    typeof destination === 'string' &&
    destination !== 'empty'
  );
}

export function previewApiGuard(req: Request, res: Response, next: NextFunction) {
  if (isPreviewApiRequest(req)) {
    res
      .status(403)
      .json({ success: false, error: 'Preview applications cannot access the Automaker API.' });
    return;
  }
  next();
}
