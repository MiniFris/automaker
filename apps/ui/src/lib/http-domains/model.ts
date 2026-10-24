import type { HttpDomainTransport } from './transport';
import type { ModelDefinition, ProviderStatus } from '@/types/electron';

export function createModelClient(transport: Pick<HttpDomainTransport, 'get'>) {
  return {
    getAvailable: async (): Promise<{
      success: boolean;
      models?: ModelDefinition[];
      error?: string;
    }> => {
      return transport.get('/api/models/available');
    },
    checkProviders: async (): Promise<{
      success: boolean;
      providers?: Record<string, ProviderStatus>;
      error?: string;
    }> => {
      return transport.get('/api/models/providers');
    },
  };
}
