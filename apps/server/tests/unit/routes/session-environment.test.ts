import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { AgentService } from '@/services/agent-service.js';
import { createIndexHandler } from '@/routes/sessions/routes/index.js';

describe('session list environment identity', () => {
  it('returns persisted model/provider and actual environment rather than the current default', async () => {
    const binding = {
      type: 'local',
      selection: { mode: 'auto' },
      fallbackReason: 'docker-preflight-unavailable',
    };
    const service = {
      listSessions: vi.fn(async () => [
        {
          id: 'session',
          name: 'Chat',
          model: 'direct-Exact/ID',
          providerId: 'endpoint-a',
          executionEnvironment: binding,
        },
      ]),
      loadSession: vi.fn(async () => []),
    };
    const response = { json: vi.fn(), status: vi.fn() };
    await createIndexHandler(service as unknown as AgentService)(
      { query: {} } as unknown as Request,
      response as unknown as Response
    );
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      sessions: [
        expect.objectContaining({
          model: 'direct-Exact/ID',
          providerId: 'endpoint-a',
          executionEnvironment: binding,
        }),
      ],
    });
  });
});
