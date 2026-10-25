import { Buffer } from 'node:buffer';
import http from 'node:http';
import path from 'node:path';

export interface EmbeddedBackendIdentity {
  apiKey: string;
  startupId: string;
  dataDirectory: string;
}

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_HEALTH_BYTES = 64 * 1024;

/** Startup-only identity check; not a continuous protection against runtime port takeover. */
export function probeBackend(port: number, identity?: EmbeddedBackendIdentity): Promise<void> {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (identity && (!identity.apiKey || !UUID4.test(identity.startupId) || !identity.dataDirectory))
  )
    return Promise.reject(new Error('Backend startup identity is invalid.'));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (valid: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (valid) resolve();
      else {
        request.destroy();
        reject(new Error('Backend health probe failed.'));
      }
    };
    const request = http.get(
      {
        hostname: 'localhost',
        port,
        path: identity ? '/api/health/detailed' : '/api/health',
        headers: identity ? { 'x-api-key': identity.apiKey } : {},
      },
      (response) => {
        const mediaType = response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
        if (
          response.statusCode !== 200 ||
          !mediaType ||
          !(
            mediaType === 'application/json' ||
            (mediaType.startsWith('application/') && mediaType.endsWith('+json'))
          )
        ) {
          finish(false);
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.byteLength;
          if (bytes > MAX_HEALTH_BYTES) {
            finish(false);
            return;
          }
          chunks.push(chunk);
        });
        response.once('aborted', () => finish(false));
        response.once('error', () => finish(false));
        response.once('end', () => {
          if (settled) return;
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
              string,
              unknown
            >;
            const valid =
              value !== null &&
              typeof value === 'object' &&
              value.status === 'ok' &&
              typeof value.version === 'string' &&
              value.version.length > 0 &&
              typeof value.timestamp === 'string' &&
              Number.isFinite(Date.parse(value.timestamp));
            const own =
              !identity ||
              (response.headers['x-automaker-instance-id'] === identity.startupId &&
                typeof value.dataDir === 'string' &&
                path.resolve(value.dataDir) === path.resolve(identity.dataDirectory));
            finish(valid && own);
          } catch {
            finish(false);
          }
        });
      }
    );
    const deadline = setTimeout(() => finish(false), 1000);
    request.once('error', () => finish(false));
  });
}
