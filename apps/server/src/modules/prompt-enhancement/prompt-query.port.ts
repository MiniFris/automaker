import type { SimpleQueryOptions, SimpleQueryResult } from '../../providers/simple-query-service.js';

export const PROMPT_QUERY = Symbol('PROMPT_QUERY');

export type PromptQuery = (options: SimpleQueryOptions) => Promise<SimpleQueryResult>;
