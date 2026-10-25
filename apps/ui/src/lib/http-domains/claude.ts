import type { HttpDomainTransport } from './transport';
import type { ClaudeUsageResponse } from '@/store/app-store';

export function createClaudeClient(transport: Pick<HttpDomainTransport, 'get'>) {
  return {
    getUsage: (): Promise<ClaudeUsageResponse> => transport.get('/api/claude/usage'),
  };
}
