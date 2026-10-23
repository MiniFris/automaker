import { Inject, Injectable } from '@nestjs/common';
import {
  simpleQuery,
  type SimpleQueryOptions,
  type SimpleQueryResult,
} from '../../providers/simple-query-service.js';
import type { ContextQueryPort } from './context-query.port.js';
import { ProviderRegistry } from '../providers/provider-registry.service.js';

@Injectable()
export class SimpleContextQueryAdapter implements ContextQueryPort {
  constructor(@Inject(ProviderRegistry) private readonly providers: ProviderRegistry) {}

  execute(options: SimpleQueryOptions): Promise<SimpleQueryResult> {
    return simpleQuery(options, this.providers);
  }
}
