import { expect, it } from 'vitest';
import {
  PreviewPolicy,
  parseRuntimeConfig,
  RuntimeConfigError,
} from '../../../src/core/config/index.js';
import { createPreviewRelay } from '../../../src/services/execution-environment/preview-tunnel.js';

it('snapshots typed preview configuration and bounded relay target ports', () => {
  const environment = {
    AUTOMAKER_PREVIEW_PORT_FIRST: '42000',
    AUTOMAKER_PREVIEW_PORT_LAST: '42002',
    AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://project-{port}.example.test',
    AUTOMAKER_PREVIEW_BIND: '127.0.0.1',
  };
  const config = parseRuntimeConfig(environment, '/owned');
  const policy = new PreviewPolicy(config.preview);
  environment.AUTOMAKER_PREVIEW_PUBLIC_URL = 'https://other-{port}.example.test';
  expect(policy.origin(42001)).toBe('https://project-42001.example.test');
  expect(Object.isFrozen(policy.config)).toBe(true);
  expect(Object.isFrozen(config.preview)).toBe(true);
  const relay = createPreviewRelay(policy);
  expect(relay).toContain('p.port<43000||p.port>43002');
  expect(() => policy.origin(42003)).toThrow('reserved preview');
});
it('preserves port and hostname public URL placeholders, defaults and container bind snapshots', () => {
  expect(parseRuntimeConfig({}, '/owned').preview).toMatchObject({
    firstPort: 3100,
    lastPort: 3119,
    bindAddress: '127.0.0.1',
  });
  expect(parseRuntimeConfig({ IS_CONTAINERIZED: 'true' }, '/owned').preview.bindAddress).toBe(
    '0.0.0.0'
  );
  expect(
    parseRuntimeConfig({ IS_CONTAINERIZED: 'true', AUTOMAKER_PREVIEW_BIND: '::1' }, '/owned')
      .preview.bindAddress
  ).toBe('::1');
  const config = parseRuntimeConfig(
    { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://preview.example.test:{port}' },
    '/owned'
  );
  expect(new PreviewPolicy(config.preview).origin(3101)).toBe('https://preview.example.test:3101');
});
it.each([
  { AUTOMAKER_PREVIEW_PORT_FIRST: '1', AUTOMAKER_PREVIEW_PORT_LAST: '257' },
  { AUTOMAKER_PREVIEW_PORT_FIRST: '64535', AUTOMAKER_PREVIEW_PORT_LAST: '64536' },
  { AUTOMAKER_PREVIEW_PORT_FIRST: '3100oops' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://preview.example.test' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'ftp://preview-{port}.example.test' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://user:pass@preview-{port}.example.test' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://preview.example.test/{port}' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://preview-{port}.example.test/?x=1' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://preview-{port}.example.test/#fragment' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'https://{unknown}-{port}.example.test' },
  { AUTOMAKER_PREVIEW_PUBLIC_URL: 'http://[' },
  { AUTOMAKER_PREVIEW_BIND: '/tmp/preview.sock' },
])('fails before resource creation for invalid preview configuration (%#)', (environment) => {
  expect(() => parseRuntimeConfig(environment, '/owned')).toThrow(RuntimeConfigError);
});
it.each([
  'broken',
  'file:///tmp/origin',
  'https://safe.example/path',
  'https://safe.example/?a=1',
  'https://user@safe.example',
  ' https://safe.example ',
  'http:\\safe.example',
])('denies malformed Origin %s independently of reserved sessions', (origin) => {
  const policy = new PreviewPolicy(parseRuntimeConfig({}, '/owned').preview);
  expect(policy.isApiRequest({ headers: { origin, 'x-api-key': 'fixture' } })).toBe(true);
});
