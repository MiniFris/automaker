import type { HttpDomainTransport } from './transport';

export function createRunningAgentsClient(transport: Pick<HttpDomainTransport, 'get'>) {
  return {
    getAll: (): Promise<{
      success: boolean;
      runningAgents?: Array<{
        featureId: string;
        projectPath: string;
        projectName: string;
        isAutoMode: boolean;
      }>;
      totalCount?: number;
      error?: string;
    }> => transport.get('/api/running-agents'),
  };
}
