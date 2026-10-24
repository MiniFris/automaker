import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { createLogger } from '@automaker/utils';
import { getCorrelationId, redactSecrets } from '../observability/request-context.js';
import { DomainError } from './domain-errors.js';

const logger = createLogger('ExceptionFilter');

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.destroyed || response.writableEnded) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const correlationId = getCorrelationId();
    const domainError = exception instanceof DomainError ? exception : undefined;
    const status =
      domainError?.statusCode ??
      (exception instanceof HttpException ? exception.getStatus() : this.readStatus(exception));
    const error = domainError?.message ?? this.readSafeMessage(exception, status);
    if (status >= 500)
      logger.error(
        'unexpected request error',
        redactSecrets({
          correlationId,
          error: exception instanceof Error ? exception.message : exception,
        })
      );
    const httpResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    if (httpResponse && typeof httpResponse === 'object' && !domainError) {
      response.status(status).json({
        ...(redactSecrets(httpResponse) as Record<string, unknown>),
        ...(correlationId && { correlationId }),
      });
      return;
    }
    const infrastructureCode =
      exception &&
      typeof exception === 'object' &&
      'code' in exception &&
      typeof exception.code === 'string'
        ? { code: exception.code }
        : {};
    response.status(status).json({
      success: false,
      error,
      ...infrastructureCode,
      ...(domainError && { errorCode: domainError.errorCode }),
      ...(correlationId && { correlationId }),
    });
  }
  private readStatus(exception: unknown): number {
    if (exception && typeof exception === 'object' && 'status' in exception) {
      const status = Number(exception.status);
      if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
    }
    return 500;
  }
  private readSafeMessage(exception: unknown, status: number): string {
    if (status >= 500) return 'Internal server error.';
    if (exception instanceof Error && exception.message) return exception.message;
    return 'Request failed.';
  }
}
