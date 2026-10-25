import type { HttpDomainTransport } from './transport';

export function createMcpClient(transport: Pick<HttpDomainTransport, 'post'>) {
  return {
    testServer: (
      serverId: string
    ): Promise<{
      success: boolean;
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        enabled: boolean;
      }>;
      error?: string;
      connectionTime?: number;
      serverInfo?: {
        name?: string;
        version?: string;
      };
    }> => transport.post('/api/mcp/test', { serverId }),

    listTools: (
      serverId: string
    ): Promise<{
      success: boolean;
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        enabled: boolean;
      }>;
      error?: string;
    }> => transport.post('/api/mcp/tools', { serverId }),
  };
}
