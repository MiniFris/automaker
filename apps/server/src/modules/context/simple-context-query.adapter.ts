import { Injectable } from '@nestjs/common';
import {
  simpleQuery,
  type SimpleQueryOptions,
  type SimpleQueryResult,
} from '../../providers/simple-query-service.js';
import type { ContextQueryPort } from './context-query.port.js';

@Injectable()
export class SimpleContextQueryAdapter implements ContextQueryPort {
  execute(options: SimpleQueryOptions): Promise<SimpleQueryResult> {
    return simpleQuery(options);
  }
}
