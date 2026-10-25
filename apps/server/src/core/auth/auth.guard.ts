import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RuntimeConfig } from '../config/index.js';
import { RUNTIME_CONFIG } from '../config/index.js';
import { ForbiddenDomainError, UnauthorizedDomainError } from '../errors/domain-errors.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || this.config.auth.disabled) return true;
    const result = this.auth.authenticateRequest(context.switchToHttp().getRequest<Request>());
    if (result.authenticated) return true;
    if (result.errorType === 'no_auth') throw new UnauthorizedDomainError();
    throw new ForbiddenDomainError(
      result.errorType === 'invalid_api_key'
        ? 'Invalid API key.'
        : 'Invalid or expired session token.'
    );
  }
}
