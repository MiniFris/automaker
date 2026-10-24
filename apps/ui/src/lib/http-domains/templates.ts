import type { HttpDomainTransport } from './transport';

export function createTemplatesClient(transport: Pick<HttpDomainTransport, 'post'>) {
  return {
    clone: (
      repoUrl: string,
      projectName: string,
      parentDir: string
    ): Promise<{
      success: boolean;
      projectPath?: string;
      projectName?: string;
      error?: string;
    }> => transport.post('/api/templates/clone', { repoUrl, projectName, parentDir }),
  };
}
