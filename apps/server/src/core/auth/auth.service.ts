import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';
import * as cookie from 'cookie';
import {
  AuthStateRepository,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
} from './auth-state.repository.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';
import { authenticationMaterial } from '../http/request-context.decorators.js';
import type { HttpAuthenticationContext } from '@automaker/contracts/domains/request-context';

export type AuthResult =
  | { authenticated: true }
  | { authenticated: false; errorType: 'invalid_api_key' | 'invalid_session' | 'no_auth' };

@Injectable()
export class AuthService implements OnApplicationShutdown {
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(AuthStateRepository) private readonly state: AuthStateRepository
  ) {
    this.cleanupInterval = setInterval(() => state.cleanupExpiredWebSocketTokens(), 60_000);
    this.cleanupInterval.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.cleanupInterval);
  }

  authenticateRequest(request: Request): AuthResult {
    return this.checkAuthentication(
      request.headers as Record<string, string | string[] | undefined>,
      request.query as Record<string, string | undefined>,
      (request.cookies ?? {}) as Record<string, string | undefined>
    );
  }
  isRequestAuthenticated(request: Request): boolean {
    return this.config.auth.disabled || this.authenticateRequest(request).authenticated;
  }
  isContextAuthenticated(context: HttpAuthenticationContext): boolean {
    return this.config.auth.disabled || this.authenticateContext(context).authenticated;
  }
  validateApiKey(apiKey: string): boolean {
    return this.state.validateApiKey(apiKey);
  }
  createSession(): Promise<string> {
    return this.state.createSession();
  }
  invalidateSession(token: string): Promise<void> {
    return this.state.invalidateSession(token);
  }
  get sessionCookieName(): string {
    return SESSION_COOKIE_NAME;
  }
  get sessionCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.environment === 'production',
      sameSite: 'lax' as const,
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    };
  }
  issueWebSocketToken(): string {
    return this.state.issueWebSocketToken();
  }
  consumeWebSocketToken(token: string): boolean {
    return this.state.consumeWebSocketToken(token);
  }

  checkAuthentication(
    headers: Record<string, string | string[] | undefined>,
    query: Record<string, string | undefined>,
    cookies: Record<string, string | undefined>
  ): AuthResult {
    return this.authenticateContext(authenticationMaterial(headers, query, cookies));
  }

  authenticateContext(context: HttpAuthenticationContext): AuthResult {
    const key = context.apiKeyHeader;
    if (key.kind !== 'absent')
      return key.kind === 'string' && this.validateApiKey(key.value)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_api_key' };
    const headerToken = context.sessionHeader;
    if (headerToken.kind !== 'absent')
      return headerToken.kind === 'string' && this.state.validateSession(headerToken.value)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_session' };
    if (context.apiKeyQuery.kind !== 'absent')
      return context.apiKeyQuery.kind === 'string' && this.validateApiKey(context.apiKeyQuery.value)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_api_key' };
    if (context.tokenQuery.kind !== 'absent')
      return context.tokenQuery.kind === 'string' &&
        this.state.validateSession(context.tokenQuery.value)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_session' };
    const token = context.sessionCookie;
    return token.kind === 'string' && this.state.validateSession(token.value)
      ? { authenticated: true }
      : { authenticated: false, errorType: 'no_auth' };
  }

  authenticateUpgrade(request: IncomingMessage): boolean {
    if (this.config.auth.disabled) return true;
    const url = new URL(request.url || '', `http://${request.headers.host ?? 'localhost'}`);
    const query: Record<string, string | undefined> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const cookies = request.headers.cookie ? cookie.parse(request.headers.cookie) : {};
    if (
      this.checkAuthentication(
        request.headers as Record<string, string | string[] | undefined>,
        query,
        cookies
      ).authenticated
    ) {
      return true;
    }
    const token = url.searchParams.get('wsToken');
    return token ? this.consumeWebSocketToken(token) : false;
  }
}
