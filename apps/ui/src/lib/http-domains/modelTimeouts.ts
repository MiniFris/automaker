import type { HttpDomainTransport } from './transport';
import type { ModelTimeoutSettings, ModelTimeoutProvider } from '@automaker/types';

export function createModelTimeoutsClient(transport: Pick<HttpDomainTransport, 'get' | 'put'>) {
  return {
    getProvider: (
      provider: ModelTimeoutProvider
    ): Promise<{ success: boolean; timeouts?: ModelTimeoutSettings; error?: string }> =>
      transport.get('/api/settings/model-timeouts/' + provider),
    saveProvider: (
      provider: ModelTimeoutProvider,
      timeouts: ModelTimeoutSettings
    ): Promise<{ success: boolean; timeouts?: ModelTimeoutSettings; error?: string }> =>
      transport.put('/api/settings/model-timeouts/' + provider, { timeouts }),
    get: (): Promise<{ success: boolean; timeouts?: ModelTimeoutSettings; error?: string }> =>
      transport.get('/api/settings/model-timeouts'),
    save: (
      timeouts: ModelTimeoutSettings
    ): Promise<{ success: boolean; timeouts?: ModelTimeoutSettings; error?: string }> =>
      transport.put('/api/settings/model-timeouts', { timeouts }),
  };
}
