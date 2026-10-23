import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Request } from 'express';
import {
  checkAuthentication,
  cleanupExpiredWsConnectionTokens,
  createWsConnectionToken,
  validateWsConnectionToken,
  type AuthResult,
} from '../../lib/auth.js';

@Injectable()
export class AuthService implements OnApplicationShutdown {
  private readonly cleanupInterval = setInterval(() => cleanupExpiredWsConnectionTokens(), 60_000);

  constructor() {
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
  issueWebSocketToken(): string {
    return createWsConnectionToken();
  }
  consumeWebSocketToken(token: string): boolean {
    return validateWsConnectionToken(token);
  }
}
