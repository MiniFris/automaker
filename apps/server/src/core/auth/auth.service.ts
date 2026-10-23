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
    const key = headers['x-api-key'];
    if (key)
      return typeof key === 'string' && this.validateApiKey(key)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_api_key' };
    const headerToken = headers['x-session-token'];
    if (headerToken)
      return typeof headerToken === 'string' && this.state.validateSession(headerToken)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_session' };
    if (query.apiKey)
      return this.validateApiKey(query.apiKey)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_api_key' };
    if (query.token)
      return this.state.validateSession(query.token)
        ? { authenticated: true }
        : { authenticated: false, errorType: 'invalid_session' };
    const token = cookies[SESSION_COOKIE_NAME];
    return token && this.state.validateSession(token)
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
