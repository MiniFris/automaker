import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ValidationDomainError } from '../errors/index.js';
import { SecurityService } from './security.service.js';

export const ALLOWED_PATH_FIELDS = 'automaker:allowed-path-fields';
export const AllowedPathFields = (...fields: string[]) => SetMetadata(ALLOWED_PATH_FIELDS, fields);

@Injectable()
export class AllowedPathGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SecurityService) private readonly security: SecurityService
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const fields =
      this.reflector.getAllAndOverride<string[]>(ALLOWED_PATH_FIELDS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const request = context.switchToHttp().getRequest<Request>();
    const values = {
      ...request.query,
      ...request.params,
      ...(request.body as object | undefined),
    } as Record<string, unknown>;
    for (const field of fields) {
      const value = values[field];
      if (typeof value !== 'string')
        throw new ValidationDomainError(`${field} must be a path string.`);
      this.security.validateLocalPath(value, `${request.method} ${request.path}`);
    }
    return true;
  }
}
