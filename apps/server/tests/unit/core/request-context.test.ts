import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  authenticationMaterial,
  clientIdentity,
  terminalLogoutContext,
} from '../../../src/core/http/request-context.decorators.js';
import { SESSION_COOKIE_NAME } from '../../../src/core/auth/auth-state.repository.js';

describe('narrow request context extraction', () => {
  it.each([undefined, null, '', false, 0])('keeps falsey credential %j absent', (value) => {
    expect(authenticationMaterial({ 'x-api-key': value }, {}, {}).apiKeyHeader).toEqual({
      kind: 'absent',
    });
  });
  it.each([[], ['key'], {}, true, 1])(
    'rejects truthy invalid material in place without coercing or throwing: %j',
    (value) => {
      const context = authenticationMaterial(
        { 'x-api-key': value },
        { apiKey: value, token: 'fallback' },
        { [SESSION_COOKIE_NAME]: value }
      );
      expect(context.apiKeyHeader).toEqual({ kind: 'invalid' });
      expect(context.apiKeyQuery).toEqual({ kind: 'invalid' });
      expect(context.sessionCookie).toEqual({ kind: 'invalid' });
      expect(context.tokenQuery).toEqual({ kind: 'string', value: 'fallback' });
    }
  );
  it('retains whitespace in strings and only projects recognized auth fields', () => {
    expect(authenticationMaterial({ 'x-api-key': '  ', extra: 'secret' }, {}, {})).toEqual({
      apiKeyHeader: { kind: 'string', value: '  ' },
      sessionHeader: { kind: 'absent' },
      apiKeyQuery: { kind: 'absent' },
      tokenQuery: { kind: 'absent' },
      sessionCookie: { kind: 'absent' },
    });
  });
  it.each([
    ['express', 'socket', 'express'],
    ['', 'socket', 'socket'],
    [undefined, undefined, 'unknown'],
  ])('keeps exact Express IP/socket fallback', (ip, remoteAddress, expected) => {
    expect(clientIdentity({ ip, socket: { remoteAddress } } as Request)).toEqual({
      clientId: expected,
    });
  });
  it.each([
    ['header', 'body', 'header'],
    ['', 'body', 'body'],
    [[], 'body', 'body'],
    [undefined, 42, undefined],
    [undefined, {}, undefined],
    [undefined, '', ''],
    ['  ', 'body', '  '],
    [undefined, null, undefined],
  ])('keeps terminal header/body selector for %j / %j', (header, body, expected) => {
    expect(
      terminalLogoutContext({
        headers: { 'x-terminal-token': header },
        body: { token: body },
      } as Request)
    ).toEqual({ token: expected });
  });
});
