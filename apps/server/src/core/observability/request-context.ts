import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Optional, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '@automaker/utils';
import { ApplicationLoggingPolicy } from './logging-policy.js';
import { METRICS, type Metrics } from './metrics.js';

const logger = createLogger('HTTP');
const storage = new AsyncLocalStorage<{ correlationId: string; operationId?: string }>();
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function getOperationId(): string | undefined {
  return storage.getStore()?.operationId;
}

export function runWithOperationContext<T>(
  correlationId: string,
  operationId: string,
  callback: () => T
): T {
  return storage.run({ correlationId, operationId }, callback);
}

export function createCorrelationId(supplied?: string): string {
  return supplied && SAFE_ID.test(supplied) ? supplied : randomUUID();
}

export function runWithCorrelationContext<T>(correlationId: string, callback: () => T): T {
  return storage.run({ correlationId }, callback);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    @Optional()
    @Inject(ApplicationLoggingPolicy)
    private readonly logging?: ApplicationLoggingPolicy
  ) {}
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header('x-request-id');
    const correlationId = createCorrelationId(supplied);
    const startedAt = performance.now();
    response.setHeader('x-request-id', correlationId);
    let recorded = false;
    const record = (outcome: 'completed' | 'aborted') => {
      if (recorded) return;
      recorded = true;
      const durationMs = performance.now() - startedAt;
      // Use registered route templates, never attacker-controlled URLs/IDs/query strings.
      const route = typeof request.route?.path === 'string' ? request.route.path : 'unmatched';
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(
        request.method
      )
        ? request.method
        : 'other';
      const labels = {
        method,
        route,
        status: String(response.statusCode),
        outcome,
      };
      this.metrics.increment('http_requests_total', labels);
      this.metrics.observe('http_request_duration_ms', durationMs, labels);
      if (this.logging?.requestLogging ?? true)
        this.runLogging(() =>
          logger.debug('request completed', {
            correlationId,
            method: request.method,
            route,
            status: response.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            outcome,
          })
        );
    };
    response.once('finish', () => record('completed'));
    response.once('close', () => record(response.writableFinished ? 'completed' : 'aborted'));
    this.runLogging(() => runWithCorrelationContext(correlationId, next));
  }
  private runLogging<T>(operation: () => T): T {
    return this.logging ? this.logging.run(operation) : operation();
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
