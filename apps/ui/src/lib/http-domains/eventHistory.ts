import type { HttpDomainTransport } from './transport';
import type { EventHistoryAPI } from '../electron';
import type { EventHistoryFilter } from '@automaker/types';

export function createEventHistoryClient(
  transport: Pick<HttpDomainTransport, 'post'>
): EventHistoryAPI {
  return {
    list: (projectPath: string, filter?: EventHistoryFilter) =>
      transport.post('/api/event-history/list', { projectPath, filter }),

    get: (projectPath: string, eventId: string) =>
      transport.post('/api/event-history/get', { projectPath, eventId }),

    delete: (projectPath: string, eventId: string) =>
      transport.post('/api/event-history/delete', { projectPath, eventId }),

    clear: (projectPath: string) => transport.post('/api/event-history/clear', { projectPath }),

    replay: (projectPath: string, eventId: string, hookIds?: string[]) =>
      transport.post('/api/event-history/replay', { projectPath, eventId, hookIds }),
  };
}
