import { afterEach, expect, it, vi } from 'vitest';
import {
  createLogger,
  getLogLevel,
  LogLevel,
  registerLoggerContextProvider,
  setLogLevel,
  type LoggerConfiguration,
} from '../src/logger.js';

const original = getLogLevel();
afterEach(() => {
  setLogLevel(original);
  vi.restoreAllMocks();
});
it('evaluates contextual policy on existing loggers without changing legacy fallback', () => {
  const logger = createLogger('Existing');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  setLogLevel(LogLevel.WARN);
  let current: LoggerConfiguration | undefined;
  const unregister = registerLoggerContextProvider(() => current);
  try {
    current = { level: LogLevel.DEBUG, colorsEnabled: false, timestampsEnabled: false };
    logger.debug('scoped');
    expect(output).toHaveBeenLastCalledWith('DEBUG [Existing]', 'scoped');
    current.level = LogLevel.ERROR;
    logger.info('hidden');
    expect(output).toHaveBeenCalledTimes(1);
    current = undefined;
    expect(getLogLevel()).toBe(LogLevel.WARN);
    logger.info('legacy hidden');
    expect(output).toHaveBeenCalledTimes(1);
  } finally {
    unregister();
  }
  setLogLevel(LogLevel.DEBUG);
  logger.debug('legacy');
  expect(output).toHaveBeenCalledTimes(2);
});
