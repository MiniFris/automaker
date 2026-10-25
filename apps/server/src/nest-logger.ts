import type { LoggerService } from '@nestjs/common';
import { createLogger } from '@automaker/utils';

const logger = createLogger('Nest');

export class NestLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    logger.info(String(message), ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    logger.error(String(message), ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    logger.warn(String(message), ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    logger.debug(String(message), ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    logger.debug(String(message), ...optionalParams);
  }
}
