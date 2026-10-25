import { createLogger } from '@automaker/utils';
const logger = createLogger('Server');

/** Production entrypoint only. The factory must not add global exception listeners. */
export function installProcessExceptionHandlers(): () => void {
  const rejection = (reason: unknown) => {
    logger.error('Unhandled Promise Rejection.', {
      errorType: reason instanceof Error ? 'error' : 'non-error',
    });
  };
  const exception = (error: Error) => {
    logger.error('Uncaught Exception.', {
      errorType: error instanceof Error ? 'error' : 'non-error',
    });
    process.exit(1);
  };
  process.on('unhandledRejection', rejection);
  process.on('uncaughtException', exception);
  return () => {
    process.removeListener('unhandledRejection', rejection);
    process.removeListener('uncaughtException', exception);
  };
}
