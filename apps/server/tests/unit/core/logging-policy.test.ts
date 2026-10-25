import { afterEach, expect, it, vi } from 'vitest';
import { createLogger, getLogLevel, LogLevel, setLogLevel } from '@automaker/utils';
import { ApplicationLoggingPolicy } from '../../../src/core/observability/logging-policy.js';
const original = getLogLevel();
afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel(original);
});
it('isolates nested/parallel async policy and restores legacy context after exceptions', async () => {
  const first = new ApplicationLoggingPolicy({ LOG_LEVEL: 'debug', LOG_COLORS: 'false' }, false),
    second = new ApplicationLoggingPolicy({ LOG_LEVEL: 'error' });
  const output = vi.spyOn(console, 'log').mockImplementation(() => {}),
    logger = createLogger('Scoped');
  setLogLevel(LogLevel.WARN);
  await Promise.all([
    first.run(async () => {
      await Promise.resolve();
      logger.debug('first');
      expect(getLogLevel()).toBe(LogLevel.DEBUG);
    }),
    second.run(async () => {
      await Promise.resolve();
      logger.info('second hidden');
      expect(getLogLevel()).toBe(LogLevel.ERROR);
    }),
  ]);
  expect(output).toHaveBeenCalledTimes(1);
  expect(() =>
    first.run(() => {
      second.run(() => {
        throw new Error('fixture');
      });
    })
  ).toThrow('fixture');
  expect(getLogLevel()).toBe(LogLevel.WARN);
  first.apply({ serverLogLevel: 'info', enableRequestLogging: true });
  expect(first.requestLogging).toBe(true);
  expect(second.configuration.level).toBe(LogLevel.ERROR);
});
it('keeps scoped parser errors and credential metadata out of diagnostics without changing legacy logger arguments', () => {
  const policy = new ApplicationLoggingPolicy({ LOG_COLORS: 'false' });
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logger = createLogger('PrivateStore');
  const error = new SyntaxError('private-parser-marker');
  policy.run(() =>
    logger.error('Settings read failed.', error, {
      apiKey: 'private-key-marker',
      nested: { prompt: 'private-prompt-marker', phase: 'read' },
    })
  );
  const call = output.mock.calls[0];
  expect(call).toEqual([
    expect.any(String),
    'Settings read failed.',
    { errorType: 'SyntaxError' },
    {
      apiKey: '[REDACTED]',
      nested: { prompt: '[REDACTED]', phase: 'read' },
    },
  ]);
  logger.error('Standalone diagnostic.', error);
  expect(output.mock.calls[1][2]).toBe(error);
});
