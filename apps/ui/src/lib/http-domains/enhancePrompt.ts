import type { HttpDomainTransport } from './transport';
import type { EnhancePromptResult } from '../http-api-client';

export function createEnhancePromptClient(transport: Pick<HttpDomainTransport, 'post'>) {
  return {
    enhance: (
      originalText: string,
      enhancementMode: string,
      model?: string,
      thinkingLevel?: string,
      projectPath?: string,
      providerId?: string
    ): Promise<EnhancePromptResult> =>
      transport.post('/api/enhance-prompt', {
        originalText,
        enhancementMode,
        model,
        thinkingLevel,
        projectPath,
        providerId,
      }),
  };
}
