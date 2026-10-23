import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';
import * as cookie from 'cookie';
import {
  checkAuthentication,
  cleanupExpiredWsConnectionTokens,
  createSession,
  createWsConnectionToken,
  getSessionCookieName,
  getSessionCookieOptions,
  invalidateSession,
  validateApiKey,
  validateWsConnectionToken,
  type AuthResult,
} from '../../lib/auth.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';

@Injectable()
export class AuthService implements OnApplicationShutdown {
  private readonly cleanupInterval = setInterval(() => cleanupExpiredWsConnectionTokens(), 60_000);

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {
    this.cleanupInterval.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.cleanupInterval);
  }

  authenticateRequest(request: Request): AuthResult {
    return checkAuthentication(
      request.headers as Record<string, string | string[] | undefined>,
      request.query as Record<string, string | undefined>,
      (request.cookies ?? {}) as Record<string, string | undefined>
    );
  }
  isRequestAuthenticated(request: Request): boolean {
    return this.config.auth.disabled || this.authenticateRequest(request).authenticated;
  }
  validateApiKey(apiKey: string): boolean {
    return validateApiKey(apiKey);
  }
  createSession(): Promise<string> {
    return createSession();
  }
  invalidateSession(token: string): Promise<void> {
    return invalidateSession(token);
  }
  get sessionCookieName(): string {
    return getSessionCookieName();
  }
  get sessionCookieOptions(): ReturnType<typeof getSessionCookieOptions> {
    return getSessionCookieOptions(this.config.environment === 'production');
  }
  issueWebSocketToken(): string {
    return createWsConnectionToken();
  }
  consumeWebSocketToken(token: string): boolean {
    return validateWsConnectionToken(token);
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
      checkAuthentication(
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
