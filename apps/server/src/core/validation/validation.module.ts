import {
  Global,
  Injectable,
  Module,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import type { ZodType } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

export interface SchemaBackedType {
  schema?: ZodType;
}

@Injectable()
export class GlobalSchemaValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = (metadata.metatype as SchemaBackedType | undefined)?.schema;
    return schema ? new ZodValidationPipe(schema).transform(value) : value;
  }
}

@Global()
@Module({ providers: [{ provide: APP_PIPE, useClass: GlobalSchemaValidationPipe }] })
export class ValidationModule {}
