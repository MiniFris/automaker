import type { HttpDomainTransport } from './transport';
import type { ZaiUsageResponse } from '@/store/app-store';

export function createZaiClient(transport: Pick<HttpDomainTransport, 'get' | 'post'>) {
  return {
    getStatus: (): Promise<{
      success: boolean;
      available: boolean;
      message?: string;
      hasApiKey?: boolean;
      hasEnvApiKey?: boolean;
      error?: string;
    }> => transport.get('/api/zai/status'),

    getUsage: (): Promise<ZaiUsageResponse> => transport.get('/api/zai/usage'),

    configure: (
      apiToken?: string,
      apiHost?: string
    ): Promise<{
      success: boolean;
      message?: string;
      isAvailable?: boolean;
      error?: string;
    }> => transport.post('/api/zai/configure', { apiToken, apiHost }),

    verify: (
      apiKey: string
    ): Promise<{
      success: boolean;
      authenticated: boolean;
      message?: string;
      error?: string;
    }> => transport.post('/api/zai/verify', { apiKey }),
  };
}
