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
        correlationId: 'exception-fixture',
      });
    }
  });
});
