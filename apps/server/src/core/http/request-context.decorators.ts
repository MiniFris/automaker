import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
  ClientIdentityContextSchema,
  HttpAuthenticationContextSchema,
  SessionCookieContextSchema,
  TerminalLogoutContextSchema,
  type CredentialSlot,
} from '@automaker/contracts/domains/request-context';
import { SESSION_COOKIE_NAME } from '../auth/auth-state.repository.js';

function credential(value: unknown): CredentialSlot {
  if (!value) return { kind: 'absent' };
  return typeof value === 'string' ? { kind: 'string', value } : { kind: 'invalid' };
}

export function authenticationMaterial(
  headers: Record<string, unknown>,
  query: Record<string, unknown>,
  cookies: Record<string, unknown>
) {
  return HttpAuthenticationContextSchema.parse({
    apiKeyHeader: credential(headers['x-api-key']),
    sessionHeader: credential(headers['x-session-token']),
    apiKeyQuery: credential(query.apiKey),
    tokenQuery: credential(query.token),
    sessionCookie: credential(cookies[SESSION_COOKIE_NAME]),
  });
}
export function clientIdentity(request: Pick<Request, 'ip' | 'socket'>) {
  // Express owns proxy interpretation. Never read forwarding headers directly here.
  return ClientIdentityContextSchema.parse({
    clientId: request.ip || request.socket.remoteAddress || 'unknown',
  });
}
export function terminalLogoutContext(request: Pick<Request, 'headers' | 'body'>) {
  return TerminalLogoutContextSchema.parse({
    token:
      (typeof request.headers['x-terminal-token'] === 'string'
        ? request.headers['x-terminal-token']
        : undefined) || (typeof request.body?.token === 'string' ? request.body.token : undefined),
  });
}
export const ClientIdentity = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  clientIdentity(context.switchToHttp().getRequest<Request>())
);
export const HttpAuthentication = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return authenticationMaterial(request.headers, request.query, request.cookies ?? {});
  }
);
export const SessionCookie = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  return SessionCookieContextSchema.parse({ token: request.cookies?.[SESSION_COOKIE_NAME] });
});
export const TerminalLogoutToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    terminalLogoutContext(context.switchToHttp().getRequest<Request>())
);
