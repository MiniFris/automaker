import { afterEach, it, expect, vi } from 'vitest';
import {
  isPreviewApiRequest,
  previewOrigin,
} from '@/services/execution-environment/preview-policy.js';
afterEach(() => vi.unstubAllEnvs());
it('blocks reserved preview origins/referrers independently of active runs or CORS configuration', () => {
  vi.stubEnv('CORS_ORIGIN', '*');
  for (const headers of [
    { origin: 'http://localhost:3100' },
    { referer: 'http://10.1.1.2:3119/path' },
    { origin: 'https://example.com:3104' },
    { origin: 'invalid' },
  ])
    expect(isPreviewApiRequest({ headers })).toBe(true);
  expect(isPreviewApiRequest({ headers: { origin: 'http://localhost:3007' } })).toBe(false);
});
it('blocks configured TLS preview hosts and refuses malformed origin templates', () => {
  vi.stubEnv('AUTOMAKER_PREVIEW_PUBLIC_URL', 'https://preview-{port}.example.test');
  expect(previewOrigin(3101)).toBe('https://preview-3101.example.test');
  expect(isPreviewApiRequest({ headers: { origin: 'https://preview-3101.example.test' } })).toBe(
    true
  );
  vi.stubEnv('AUTOMAKER_PREVIEW_PUBLIC_URL', 'https://example.test/path/{port}');
  expect(() => previewOrigin(3101)).toThrow('origin template');
});
it('rejects cookie-bearing opaque/no-referrer cross-site navigation but preserves native key clients and same-origin API assets', () => {
  expect(isPreviewApiRequest({ headers: { origin: 'null' } })).toBe(true);
  expect(isPreviewApiRequest({ headers: { origin: 'null', 'x-api-key': 'native-client' } })).toBe(
    false
  );
  expect(
    isPreviewApiRequest({ headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'script' } })
  ).toBe(true);
  expect(
    isPreviewApiRequest({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'image' } })
  ).toBe(false);
  expect(isPreviewApiRequest({ headers: {} })).toBe(false);
});
