import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '@automaker/utils';

const logger = createLogger('HTTP');
const storage = new AsyncLocalStorage<{ correlationId: string }>();
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function createCorrelationId(supplied?: string): string {
  return supplied && SAFE_ID.test(supplied) ? supplied : randomUUID();
}

export function runWithCorrelationContext<T>(correlationId: string, callback: () => T): T {
  return storage.run({ correlationId }, callback);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header('x-request-id');
    const correlationId = createCorrelationId(supplied);
    const startedAt = performance.now();
    response.setHeader('x-request-id', correlationId);
    response.once('finish', () =>
      logger.debug('request completed', {
        correlationId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })
    );
    runWithCorrelationContext(correlationId, next);
  }
}

const SECRET_KEY = /authorization|cookie|token|api[-_]?key|password|credential|prompt/i;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(nested),
    ])
  );
}
