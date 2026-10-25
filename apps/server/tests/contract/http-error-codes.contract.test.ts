import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { createNativeWorktreeHttp } from '../helpers/native-worktree-http.js';
import { ReadinessStateService } from '../../src/core/lifecycle/readiness-state.service.js';
import { ConflictDomainError } from '../../src/core/errors/domain-errors.js';

it('adds stable HTTP error categories without replacing status, domain codes or safe legacy fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-error-codes-'));
  const runtime = await createNativeWorktreeHttp({ root });
  try {
    const headers = { 'x-api-key': runtime.apiKey, 'x-request-id': 'error-code-fixture' };
    async function check(route: string, status: number, errorCode: string, init: RequestInit = {}) {
      const response = await fetch(runtime.url + '/api/' + route, { headers, ...init });
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.errorCode).toBe(errorCode);
      return body;
    }
    await check('health/detailed', 401, 'UNAUTHORIZED', { headers: {} });
    await check('health/detailed', 403, 'FORBIDDEN', { headers: { 'x-api-key': 'invalid' } });
    const missing = await check('missing-error-fixture', 404, 'NOT_FOUND');
    expect(missing).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      correlationId: 'error-code-fixture',
    });
    expect(missing.message).toContain('missing-error-fixture');
    await check('auth/login', 415, 'UNSUPPORTED_MEDIA_TYPE', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'text/plain' },
      body: 'opaque body',
    });
    const malformed = await check('auth/login', 400, 'VALIDATION_ERROR', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{"apiKey":"secret-invalid-json"',
    });
    expect(malformed).toMatchObject({ success: false, error: 'Invalid JSON request body.' });
    expect(JSON.stringify(malformed)).not.toContain('secret-invalid-json');
    await check('health/detailed', 403, 'FORBIDDEN', {
      headers: { ...headers, origin: 'http://127.0.0.1:43300' },
    });
    const handler = vi.spyOn(runtime.app.get(ReadinessStateService), 'snapshot');
    handler.mockImplementationOnce(() => {
      throw new Error('private-provider-text');
    });
    expect(await check('health/ready', 500, 'INTERNAL_ERROR')).toMatchObject({
      success: false,
      error: 'Internal server error.',
      correlationId: 'error-code-fixture',
    });
    handler.mockImplementationOnce(() => {
      throw new ConflictDomainError('Controlled conflict.');
    });
    expect(await check('health/ready', 409, 'CONFLICT')).toMatchObject({
      error: 'Controlled conflict.',
    });
    handler.mockImplementationOnce(() => {
      throw { status: 502, code: 'TARGET_TRANSPORT_LOST', message: 'private-upstream-text' };
    });
    expect(await check('health/ready', 502, 'UPSTREAM_ERROR')).toMatchObject({
      code: 'TARGET_TRANSPORT_LOST',
      error: 'Internal server error.',
    });
    handler.mockImplementationOnce(() => {
      throw new HttpException({ message: 'Rate limited.', retryAfter: 5 }, 429);
    });
    expect(await check('health/ready', 429, 'RATE_LIMITED')).toMatchObject({
      message: 'Rate limited.',
      retryAfter: 5,
    });
    handler.mockImplementationOnce(() => {
      throw new HttpException(
        { errorCode: 'SPECIFIC_FAILURE', message: 'Controlled failure.' },
        422
      );
    });
    await check('health/ready', 422, 'SPECIFIC_FAILURE');
  } finally {
    vi.restoreAllMocks();
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
