import type { HttpDomainTransport } from './transport';
import type { Message } from '@/types/electron';
import type { EventCallback } from '../http-api-client';

export function createAgentClient(
  transport: Pick<HttpDomainTransport, 'post' | 'subscribeToEvent'>
) {
  return {
    start: (
      sessionId: string,
      workingDirectory?: string
    ): Promise<{
      success: boolean;
      messages?: Message[];
      error?: string;
    }> => transport.post('/api/agent/start', { sessionId, workingDirectory }),

    send: (
      sessionId: string,
      message: string,
      workingDirectory?: string,
      imagePaths?: string[],
      model?: string,
      thinkingLevel?: string,
      providerId?: string
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/agent/send', {
        sessionId,
        message,
        workingDirectory,
        imagePaths,
        model,
        thinkingLevel,
        providerId,
      }),

    getHistory: (
      sessionId: string
    ): Promise<{
      success: boolean;
      messages?: Message[];
      isRunning?: boolean;
      error?: string;
    }> => transport.post('/api/agent/history', { sessionId }),

    stop: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/agent/stop', { sessionId }),

    clear: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/agent/clear', { sessionId }),

    onStream: (callback: (data: unknown) => void): (() => void) => {
      return transport.subscribeToEvent('agent:stream', callback as EventCallback);
    },

    // Queue management
    queueAdd: (
      sessionId: string,
      message: string,
      imagePaths?: string[],
      model?: string,
      thinkingLevel?: string,
      providerId?: string
    ): Promise<{
      success: boolean;
      queuedPrompt?: {
        id: string;
        message: string;
        imagePaths?: string[];
        model?: string;
        thinkingLevel?: string;
        addedAt: string;
      };
      error?: string;
    }> =>
      transport.post('/api/agent/queue/add', {
        sessionId,
        message,
        imagePaths,
        model,
        thinkingLevel,
        providerId,
      }),

    queueList: (
      sessionId: string
    ): Promise<{
      success: boolean;
      queue?: Array<{
        id: string;
        message: string;
        imagePaths?: string[];
        model?: string;
        thinkingLevel?: string;
        addedAt: string;
        deliveryStatus?: 'interrupted';
      }>;
      error?: string;
    }> => transport.post('/api/agent/queue/list', { sessionId }),

    queueRemove: (
      sessionId: string,
      promptId: string
    ): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/agent/queue/remove', { sessionId, promptId }),

    queueClear: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      transport.post('/api/agent/queue/clear', { sessionId }),
  };
}
