import { PreviewPolicy } from '../../core/config/preview-policy.js';
import path from 'node:path';

/** Standalone compatibility only. Native composition always passes its application policy. */
export function legacyPreviewPolicy(): PreviewPolicy {
  return new PreviewPolicy({
    firstPort: Number(process.env.AUTOMAKER_PREVIEW_PORT_FIRST ?? '3100'),
    lastPort: Number(process.env.AUTOMAKER_PREVIEW_PORT_LAST ?? '3119'),
    publicUrl: process.env.AUTOMAKER_PREVIEW_PUBLIC_URL || undefined,
    bindAddress:
      process.env.AUTOMAKER_PREVIEW_BIND ??
      (process.env.IS_CONTAINERIZED === 'true' ? '0.0.0.0' : '127.0.0.1'),
  });
}
export function legacyPreviewPathResolver(): (alias?: string) => string {
  const directory = process.cwd();
  return (alias) => path.resolve(directory, alias ?? '.');
}
