import dotenv from 'dotenv';
import * as platform from '@automaker/platform';
import { expect, it, vi } from 'vitest';

it('imports the native factory without dotenv loading, global path initialization or host authentication probes', async () => {
  const dotenvConfig = vi.spyOn(dotenv, 'config');
  const paths = vi.spyOn(platform, 'initAllowedPaths');
  const authentication = vi.spyOn(platform, 'getClaudeAuthIndicators');
  const environment = { ...process.env };
  const rejectionListeners = process.listeners('unhandledRejection');
  const exceptionListeners = process.listeners('uncaughtException');
  try {
    await import('../../../src/main.js');
    expect(dotenvConfig).not.toHaveBeenCalled();
    expect(paths).not.toHaveBeenCalled();
    expect(authentication).not.toHaveBeenCalled();
    expect(process.env).toEqual(environment);
    expect(process.listeners('unhandledRejection')).toEqual(rejectionListeners);
    expect(process.listeners('uncaughtException')).toEqual(exceptionListeners);
  } finally {
    vi.restoreAllMocks();
  }
});
