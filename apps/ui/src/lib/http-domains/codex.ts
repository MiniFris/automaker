import type { HttpDomainTransport } from './transport';
import type { CodexUsageResponse } from '@/store/app-store';

export function createCodexClient(transport: Pick<HttpDomainTransport, 'get'>) {
  return {
    getUsage: (): Promise<CodexUsageResponse> => transport.get('/api/codex/usage'),
    getModels: (
      refresh = false
    ): Promise<{
      success: boolean;
      models?: Array<{
        id: string;
        label: string;
        description: string;
        hasThinking: boolean;
        supportsVision: boolean;
        tier: 'premium' | 'standard' | 'basic';
        isDefault: boolean;
      }>;
      cachedAt?: number;
      error?: string;
    }> => {
      const url = `/api/codex/models${refresh ? '?refresh=true' : ''}`;
      return transport.get(url);
    },
  };
}
