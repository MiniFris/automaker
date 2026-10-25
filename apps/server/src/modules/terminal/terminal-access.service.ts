import {
  Inject,
  HttpException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TerminalAccessService implements OnApplicationShutdown {
  private readonly tokens = new Map<string, { expiresAt: number }>();
  private readonly cleanupInterval = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {
    this.cleanupInterval.unref();
  }

  get enabled(): boolean {
    return this.config.terminal.enabled;
  }

  get passwordRequired(): boolean {
    return Boolean(this.config.terminal.password);
  }

  authenticate(password: unknown) {
    if (!this.enabled)
      return { status: 403, body: { success: false, error: 'Terminal access is disabled' } };
    if (!this.passwordRequired) {
      return {
        status: 200,
        body: { success: true, data: { authenticated: true, passwordRequired: false } },
      };
    }
    if (typeof password !== 'string' || password !== this.config.terminal.password) {
      return { status: 401, body: { success: false, error: 'Invalid password' } };
    }
    const token = `term-${randomBytes(32).toString('base64url')}`;
    this.tokens.set(token, { expiresAt: Date.now() + TOKEN_EXPIRY_MS });
    return {
      status: 200,
      body: { success: true, data: { authenticated: true, token, expiresIn: TOKEN_EXPIRY_MS } },
    };
  }

  logout(token: string | undefined): void {
    if (token) this.tokens.delete(token);
  }

  validate(token: string | undefined): boolean {
    if (!token) return false;
    const value = this.tokens.get(token);
    if (!value) return false;
    if (value.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  authorize(token: string | undefined): boolean {
    return this.enabled && (!this.passwordRequired || this.validate(token));
  }

  onApplicationShutdown(): void {
    clearInterval(this.cleanupInterval);
    this.tokens.clear();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, value] of this.tokens) {
      if (value.expiresAt < now) this.tokens.delete(token);
    }
  }
}

@Injectable()
export class TerminalAccessGuard implements CanActivate {
  constructor(@Inject(TerminalAccessService) private readonly access: TerminalAccessService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token =
      (typeof request.headers['x-terminal-token'] === 'string'
        ? request.headers['x-terminal-token']
        : undefined) || (typeof request.query.token === 'string' ? request.query.token : undefined);
    if (!this.access.enabled) {
      throw new HttpException({ success: false, error: 'Terminal access is disabled' }, 403);
    }
    if (this.access.passwordRequired && !this.access.validate(token)) {
      throw new HttpException(
        {
          success: false,
          error: 'Terminal authentication required',
          passwordRequired: true,
        },
        401
      );
    }
    return true;
  }
}
