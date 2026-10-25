import type { HttpDomainTransport } from './transport';

export function createContextClient(transport: Pick<HttpDomainTransport, 'post'>) {
  return {
    describeImage: (
      imagePath: string
    ): Promise<{
      success: boolean;
      description?: string;
      error?: string;
    }> => transport.post('/api/context/describe-image', { imagePath }),

    describeFile: (
      filePath: string
    ): Promise<{
      success: boolean;
      description?: string;
      error?: string;
    }> => transport.post('/api/context/describe-file', { filePath }),
  };
}
