import type { HttpDomainTransport } from './transport';
import type {
  OpenAICompatibleEndpoint,
  OpenAICompatibleEndpointStatus,
  DirectAgentSettings,
} from '@automaker/types';

export function createDirectEndpointsClient(
  transport: Pick<HttpDomainTransport, 'get' | 'put' | 'post'>
) {
  return {
    list: (): Promise<{
      success: boolean;
      endpoints: OpenAICompatibleEndpointStatus[];
      agentSettings: DirectAgentSettings;
      error?: string;
    }> => transport.get('/api/settings/openai-compatible'),
    save: (
      endpoint: OpenAICompatibleEndpoint,
      apiKey?: string,
      clearKey?: boolean
    ): Promise<{
      success: boolean;
      endpoints: OpenAICompatibleEndpointStatus[];
      agentSettings: DirectAgentSettings;
      error?: string;
    }> => transport.put('/api/settings/openai-compatible/endpoint', { endpoint, apiKey, clearKey }),
    remove: (
      providerId: string
    ): Promise<{
      success: boolean;
      endpoints: OpenAICompatibleEndpointStatus[];
      agentSettings: DirectAgentSettings;
      error?: string;
    }> => transport.post('/api/settings/openai-compatible/remove', { providerId }),
    saveAgent: (
      settings: DirectAgentSettings
    ): Promise<{
      success: boolean;
      endpoints: OpenAICompatibleEndpointStatus[];
      agentSettings: DirectAgentSettings;
      error?: string;
    }> => transport.put('/api/settings/openai-compatible/agent', settings),
    models: (
      providerId: string
    ): Promise<{ success: boolean; models?: string[]; error?: string }> =>
      transport.post('/api/settings/openai-compatible/models', { providerId }),
    test: (
      providerId: string,
      modelId: string,
      tools = false
    ): Promise<{ success: boolean; verified?: boolean; error?: string }> =>
      transport.post('/api/settings/openai-compatible/test', { providerId, modelId, tools }),
  };
}
