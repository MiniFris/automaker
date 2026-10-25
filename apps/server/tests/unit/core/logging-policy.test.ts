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
