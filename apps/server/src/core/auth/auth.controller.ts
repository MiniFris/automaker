import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UnauthorizedDomainError } from '../errors/index.js';
import { ZodValidationPipe } from '../validation/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import { LoginAttemptStore } from './login-attempt.store.js';
import { Public } from './public.decorator.js';
import { LoginRequestSchema, type LoginRequest } from './auth.schemas.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(LoginAttemptStore) private readonly attempts: LoginAttemptStore,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}

  @Public()
  @Get('status')
  async status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<Record<string, unknown>> {
    let authenticated = this.auth.isRequestAuthenticated(request);
    if (!authenticated && this.config.auth.autoLogin && this.config.environment !== 'production') {
      response.cookie(
        this.auth.sessionCookieName,
        await this.auth.createSession(),
        this.auth.sessionCookieOptions
      );
      authenticated = true;
    }
    return { success: true, authenticated, required: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(LoginRequestSchema)) input: LoginRequest
  ): Promise<Record<string, unknown>> {
    const clientIp = this.clientIp(request);
    const rateLimit = this.attempts.check(clientIp);
    if (!rateLimit.allowed)
      throw new HttpException(
        {
          success: false,
          error: 'Too many login attempts. Please try again later.',
          retryAfter: rateLimit.retryAfterSeconds,
        },
        429
      );
    if (!this.auth.validateApiKey(input.apiKey)) {
      this.attempts.recordFailure(clientIp);
      throw new UnauthorizedDomainError('Invalid API key.');
    }
    this.attempts.reset(clientIp);
    const token = await this.auth.createSession();
    response.cookie(this.auth.sessionCookieName, token, this.auth.sessionCookieOptions);
    return { success: true, message: 'Logged in successfully.', token };
  }

  @Get('token')
  token(): Record<string, unknown> {
    return { success: true, token: this.auth.issueWebSocketToken(), expiresIn: 300 };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<Record<string, unknown>> {
    const token = request.cookies?.[this.auth.sessionCookieName] as string | undefined;
    if (token) await this.auth.invalidateSession(token);
    response.cookie(this.auth.sessionCookieName, '', {
      ...this.auth.sessionCookieOptions,
      maxAge: 0,
      expires: new Date(0),
    });
    return { success: true, message: 'Logged out successfully.' };
  }

  private clientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return first.trim();
    }
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
