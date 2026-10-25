import type { HttpDomainTransport } from './transport';
import type { GeminiUsage } from '@/store/app-store';

export function createGeminiClient(transport: Pick<HttpDomainTransport, 'get'>) {
  return {
    getUsage: (): Promise<GeminiUsage> => transport.get('/api/gemini/usage'),
  };
}
