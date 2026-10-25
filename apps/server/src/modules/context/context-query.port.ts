import type {
  SimpleQueryOptions,
  SimpleQueryResult,
} from '../../providers/simple-query-service.js';

export const CONTEXT_QUERY_PORT = Symbol('CONTEXT_QUERY_PORT');

export interface ContextQueryPort {
  execute(options: SimpleQueryOptions): Promise<SimpleQueryResult>;
}
