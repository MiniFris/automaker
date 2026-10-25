import { inspect } from 'node:util';
import { installProcessExceptionHandlers } from '../../../src/core/lifecycle/process-exception-handlers.js';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }));
vi.mock('@automaker/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@automaker/utils')>()),
  createLogger: () => ({ error: errorLog }),
}));

import { GlobalExceptionFilter } from '../../../src/core/errors/global-exception.filter.js';
import { UnavailableDomainError } from '../../../src/core/errors/domain-errors.js';
import { runWithCorrelationContext } from '../../../src/core/observability/request-context.js';

describe('exception diagnostic confidentiality', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [new Error('Authorization: Bearer secret-fixture-token; prompt=private-fixture'), 'unexpected'],
    [
      { message: 'https://user:secret-fixture-token@host', nested: 'private-fixture' },
      'unexpected',
    ],
    [new HttpException('secret-fixture-token', 503), 'http'],
    [new UnavailableDomainError('secret-fixture-token'), 'domain'],
  ])('logs only bounded classification and correlation for %s', (error, errorType) => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status, json }) }),
    } as unknown as ArgumentsHost;

    runWithCorrelationContext('exception-fixture', () =>
      new GlobalExceptionFilter().catch(error, host)
    );

    expect(errorLog).toHaveBeenCalledExactlyOnceWith('unexpected request error', {
      correlationId: 'exception-fixture',
      status: error instanceof HttpException || error instanceof UnavailableDomainError ? 503 : 500,
      errorType,
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-fixture-token');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-fixture');
    if (errorType === 'unexpected') {
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error.',
        errorCode: 'INTERNAL_ERROR',
        correlationId: 'exception-fixture',
      });
    }
  });
});

it('production process handlers classify fatal and rejected failures without raw text or stack', () => {
  const on = vi.spyOn(process, 'on').mockReturnValue(process);
  const remove = vi.spyOn(process, 'removeListener').mockReturnValue(process);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  try {
    const dispose = installProcessExceptionHandlers();
    const rejection = on.mock.calls.find(([event]) => event === 'unhandledRejection')![1] as (
      reason: unknown
    ) => void;
    const exception = on.mock.calls.find(([event]) => event === 'uncaughtException')![1] as (
      reason: Error
    ) => void;
    rejection(new Error('private-process-marker'));
    exception(new Error('private-process-marker'));
    expect(inspect(errorLog.mock.calls)).not.toContain('private-process-marker');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    dispose();
    expect(remove).toHaveBeenCalledWith('unhandledRejection', rejection);
    expect(remove).toHaveBeenCalledWith('uncaughtException', exception);
  } finally {
    vi.restoreAllMocks();
  }
});
