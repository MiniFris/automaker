import type { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { AuthGuard } from '../../../src/core/auth/auth.guard.js';
import type { AuthService } from '../../../src/core/auth/auth.service.js';
import {
  ForbiddenDomainError,
  mapInfrastructureError,
  UnauthorizedDomainError,
  ValidationDomainError,
} from '../../../src/core/errors/domain-errors.js';
import { GlobalExceptionFilter } from '../../../src/core/errors/global-exception.filter.js';
import type { RuntimeConfig } from '../../../src/core/config/index.js';
import { LoginAttemptStore } from '../../../src/core/auth/index.js';
import { ZodValidationPipe } from '../../../src/core/validation/zod-validation.pipe.js';
import { GlobalSchemaValidationPipe } from '../../../src/core/validation/validation.module.js';
import { ExecutionSelectionSchema, PaginationQuerySchema } from '@automaker/contracts';

const config = { auth: { disabled: false } } as RuntimeConfig;
const context = {
  switchToHttp: () => ({ getRequest: () => ({}) }),
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
} as unknown as ExecutionContext;

describe('Nest auth and errors', () => {
  it.each([
    [{ authenticated: false, errorType: 'no_auth' }, UnauthorizedDomainError],
    [{ authenticated: false, errorType: 'invalid_api_key' }, ForbiddenDomainError],
    [{ authenticated: false, errorType: 'invalid_session' }, ForbiddenDomainError],
  ] as const)('maps authentication failures to stable domain errors', (result, ErrorType) => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector;
    const auth = { authenticateRequest: vi.fn().mockReturnValue(result) } as unknown as AuthService;
    const guard = new AuthGuard(reflector, auth, config);
    expect(() => guard.canActivate(context)).toThrow(ErrorType);
  });

  it('allows public routes without reading credentials', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) } as unknown as Reflector;
    const auth = { authenticateRequest: vi.fn() } as unknown as AuthService;
    expect(new AuthGuard(reflector, auth, config).canActivate(context)).toBe(true);
    expect(auth.authenticateRequest).not.toHaveBeenCalled();
  });

  it('rate limits failures in an injectable time-window store', () => {
    const store = new LoginAttemptStore(2, 1_000);
    store.recordFailure('client', 100);
    store.recordFailure('client', 200);
    expect(store.check('client', 300)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(store.check('client', 1_200)).toEqual({ allowed: true });
  });

  it('starts with an empty brute-force window after an application restart', () => {
    const previousProcessStore = new LoginAttemptStore(1, 60_000);
    previousProcessStore.recordFailure('client', 100);
    expect(previousProcessStore.check('client', 200).allowed).toBe(false);

    const restartedProcessStore = new LoginAttemptStore(1, 60_000);
    expect(restartedProcessStore.check('client', 200)).toEqual({ allowed: true });
  });

  it('returns a legacy-compatible safe error envelope', () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status, json }) }),
    } as unknown as ArgumentsHost;
    new GlobalExceptionFilter().catch(new ValidationDomainError('Bad field.'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Bad field.',
        errorCode: 'VALIDATION_ERROR',
      })
    );
  });

  it('maps infrastructure failures without exposing raw details', () => {
    expect(
      mapInfrastructureError(Object.assign(new Error('/secret missing'), { code: 'ENOENT' }))
    ).toMatchObject({ errorCode: 'NOT_FOUND', message: 'Resource not found.' });
    expect(mapInfrastructureError(new Error('git merge conflict'))).toMatchObject({
      errorCode: 'CONFLICT',
    });
    expect(
      mapInfrastructureError(Object.assign(new Error('socket failed'), { code: 'ECONNREFUSED' }))
    ).toMatchObject({ errorCode: 'UNAVAILABLE' });
  });

  it('rejects unknown fields in security-sensitive request schemas', () => {
    const pipe = new ZodValidationPipe(ExecutionSelectionSchema);
    expect(() => pipe.transform({ type: 'local', unexpected: true })).toThrow(
      ValidationDomainError
    );
    expect(pipe.transform({ type: 'ssh', targetId: 'target-1' })).toEqual({
      type: 'ssh',
      targetId: 'target-1',
    });
  });

  it('coerces values only in an explicitly opted-in query schema', () => {
    expect(PaginationQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
  });

  it('applies schemas globally only to schema-backed DTO metadata', () => {
    class SelectionDto {
      static readonly schema = ExecutionSelectionSchema;
    }
    const pipe = new GlobalSchemaValidationPipe();
    const metadata = { type: 'body', metatype: SelectionDto, data: undefined } as const;
    expect(pipe.transform({ type: 'local' }, metadata)).toEqual({ type: 'local' });
    expect(() => pipe.transform({ type: 'local', unknown: true }, metadata)).toThrow(
      ValidationDomainError
    );
  });
});
