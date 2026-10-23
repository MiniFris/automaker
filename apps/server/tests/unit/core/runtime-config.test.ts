import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig, RuntimeConfigError } from '../../../src/core/config/index.js';

describe('runtime config', () => {
  it('applies safe server, auth, terminal and preview defaults', () => {
    const config = parseRuntimeConfig({}, '/workspace');

    expect(config).toMatchObject({
      environment: 'development',
      server: { host: '0.0.0.0', port: 3008, corsOrigins: [] },
      auth: { disabled: false, autoLogin: false },
      terminal: { enabled: true, maxSessions: 1000 },
      preview: { firstPort: 3100, lastPort: 3119 },
    });
    expect(config.storage.dataDirectory).toBe(path.resolve('/workspace/data'));
  });

  it('parses Electron/Docker runtime values without requiring provider credentials', () => {
    const config = parseRuntimeConfig(
      {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '43100',
        DATA_DIR: 'state',
        CORS_ORIGIN: 'https://one.example, https://two.example',
        TERMINAL_ENABLED: 'false',
        IS_CONTAINERIZED: 'true',
      },
      '/application'
    );

    expect(config.server).toMatchObject({
      host: '127.0.0.1',
      port: 43100,
      corsOrigins: ['https://one.example', 'https://two.example'],
    });
    expect(config.storage.dataDirectory).toBe('/application/state');
    expect(config.terminal.enabled).toBe(false);
    expect(config.execution.containerized).toBe(true);
  });

  it.each([
    [{ PORT: '-1' }, 'PORT'],
    [{ PORT: '70000' }, 'PORT'],
    [{ TERMINAL_ENABLED: 'sometimes' }, 'TERMINAL_ENABLED'],
    [
      { AUTOMAKER_PREVIEW_PORT_FIRST: '4000', AUTOMAKER_PREVIEW_PORT_LAST: '3999' },
      'AUTOMAKER_PREVIEW_PORT_FIRST',
    ],
  ])('rejects invalid runtime configuration %#', (environment, expectedIssue) => {
    expect(() => parseRuntimeConfig(environment)).toThrow(RuntimeConfigError);
    expect(() => parseRuntimeConfig(environment)).toThrow(expectedIssue);
  });
});
