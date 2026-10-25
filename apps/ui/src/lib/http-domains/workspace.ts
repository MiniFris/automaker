import type { HttpDomainTransport } from './transport';

export function createWorkspaceClient(transport: Pick<HttpDomainTransport, 'get'>) {
  return {
    getConfig: (): Promise<{
      success: boolean;
      configured: boolean;
      workspaceDir?: string;
      defaultDir?: string | null;
      error?: string;
    }> => transport.get('/api/workspace/config'),

    getDirectories: (): Promise<{
      success: boolean;
      directories?: Array<{ name: string; path: string }>;
      error?: string;
    }> => transport.get('/api/workspace/directories'),
  };
}
