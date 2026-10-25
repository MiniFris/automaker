import { Injectable, type PipeTransform } from '@nestjs/common';
import { ValidationDomainError } from '../errors/index.js';

interface ValidationSchema {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | {
        success: false;
        error: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ValidationSchema) {}
  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationDomainError(
      result.error.issues
        .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
        .join('; ')
    );
  }
}
