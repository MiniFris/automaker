import { Inject, Injectable, type PipeTransform } from '@nestjs/common';
import { ValidationDomainError } from '../errors/index.js';
import { SecurityService } from './security.service.js';

@Injectable()
export class ProjectPathPipe implements PipeTransform<unknown, string> {
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {}
  transform(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new ValidationDomainError('Project path is required.');
    return this.security.validateLocalPath(value, 'project path validation');
  }
}
