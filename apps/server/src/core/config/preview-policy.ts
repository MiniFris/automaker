import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

export const PREVIEW_BOOTSTRAP = '/__automaker_preview';
export const MAX_PREVIEW_PORTS = 256;
export interface PreviewConfig {
  firstPort: number;
  lastPort: number;
  publicUrl?: string;
  bindAddress: string;
}
function origin(template: string | undefined, port: number): string {
  if (!template) return `http://localhost:${port}`;
  if (!template.includes('{port}'))
    throw new Error('AUTOMAKER_PREVIEW_PUBLIC_URL must contain {port} (port or hostname).');
  const replaced = template.replaceAll('{port}', String(port));
  if (/[{}]/.test(replaced))
    throw new Error('AUTOMAKER_PREVIEW_PUBLIC_URL contains unknown placeholders.');
  const url = new URL(replaced);
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
export function validatePreviewConfig(value: PreviewConfig): Readonly<PreviewConfig> {
  if (
    !Number.isInteger(value.firstPort) ||
    !Number.isInteger(value.lastPort) ||
    value.firstPort < 1 ||
    value.lastPort > 64535 ||
    value.firstPort > value.lastPort ||
    value.lastPort - value.firstPort + 1 > MAX_PREVIEW_PORTS
  )
    throw new Error(
      `AUTOMAKER_PREVIEW_PORT_FIRST/LAST must reserve 1–${MAX_PREVIEW_PORTS} ports within 1–64535 (target ports add 1000).`
    );
  if (
    !value.bindAddress ||
    !(
      isIP(value.bindAddress) ||
      /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value.bindAddress)
    )
  )
    throw new Error('AUTOMAKER_PREVIEW_BIND must be an IP address or hostname.');
  for (let port = value.firstPort; port <= value.lastPort; port++) origin(value.publicUrl, port);
  return Object.freeze({ ...value });
}

/** Immutable per-application policy, independent of preview sessions and live process globals. */
export class PreviewPolicy {
  readonly config: Readonly<PreviewConfig>;
  private readonly origins: ReadonlySet<string>;
  constructor(config: PreviewConfig) {
    this.config = validatePreviewConfig(config);
    this.origins = new Set(
      Array.from({ length: this.config.lastPort - this.config.firstPort + 1 }, (_, offset) =>
        this.origin(this.config.firstPort + offset)
      )
    );
  }
  origin(port: number): string {
    if (!Number.isInteger(port) || port < this.config.firstPort || port > this.config.lastPort)
      throw new Error('Port is outside the reserved preview range.');
    return origin(this.config.publicUrl, port);
  }
  private previewAddress(value: unknown, originHeader: boolean): boolean {
    if (value === undefined || value === 'null') return false;
    if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\'))
      return true;
    try {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        (originHeader && (url.pathname !== '/' || url.search || url.hash))
      )
        return true;
      if (Number(url.port) >= this.config.firstPort && Number(url.port) <= this.config.lastPort)
        return true;
      return this.origins.has(url.origin);
    } catch {
      return true;
    }
  }
  isApiRequest(request: Pick<IncomingMessage, 'headers'>): boolean {
    const { origin, referer } = request.headers;
    if (this.previewAddress(origin, true) || this.previewAddress(referer, false)) return true;
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
  readonly apiGuard = (req: Request, res: Response, next: NextFunction): void => {
    if (this.isApiRequest(req)) {
      res.status(403).json({
        success: false,
        error: 'Preview applications cannot access the Automaker API.',
        errorCode: 'FORBIDDEN',
      });
      return;
    }
    next();
  };
}
