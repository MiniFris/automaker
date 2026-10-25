import type { HttpDomainTransport } from './transport';
import type { SessionCreateInput, SessionUpdateInput } from '@automaker/contracts';
import type { SessionListItem } from '@/types/electron';

export function createSessionsClient(
  transport: Pick<HttpDomainTransport, 'get' | 'post' | 'put' | 'httpDelete'>
) {
  return {
    list: (
      includeArchived?: boolean
    ): Promise<{
      success: boolean;
      sessions?: SessionListItem[];
      error?: string;
    }> => transport.get(`/api/sessions?includeArchived=${includeArchived || false}`),

    create: (
      name: SessionCreateInput['name'],
      projectPath: NonNullable<SessionCreateInput['projectPath']>,
      workingDirectory?: SessionCreateInput['workingDirectory']
    ): Promise<{
      success: boolean;
      session?: {
        id: string;
        name: string;
        projectPath: string;
        workingDirectory?: string;
        createdAt: string;
        updatedAt: string;
      };
      error?: string;
    }> => transport.post('/api/sessions', { name, projectPath, workingDirectory }),

    update: (
      sessionId: string,
      name?: SessionUpdateInput['name'],
      tags?: SessionUpdateInput['tags']
    ): Promise<{ success: boolean; error?: string }> =>
      transport.put(`/api/sessions/${sessionId}`, { name, tags }),

    archive: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      transport.post(`/api/sessions/${sessionId}/archive`, {}),

    unarchive: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      transport.post(`/api/sessions/${sessionId}/unarchive`, {}),

    delete: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      transport.httpDelete(`/api/sessions/${sessionId}`),
  };
}
