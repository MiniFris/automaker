import { describe, expect, it, vi } from 'vitest';
import { SessionApplicationService } from '../../../src/modules/sessions/session-application.service.js';
import type { SessionMetadataRepository } from '../../../src/modules/sessions/session-metadata.repository.js';

describe('native session list environment identity', () => {
  it('returns persisted model/provider and captured environment rather than the current default', async () => {
    const binding = {
      version: 1 as const,
      id: 'captured-binding',
      type: 'local' as const,
      projectPath: '/project',
      cwd: '/project',
      createdAt: 'historical timestamp',
      serverIdentity: 'fixture-server',
      selection: { mode: 'auto' as const },
      source: 'global' as const,
      fallbackReason: 'docker-preflight-unavailable',
    };
    const repository = {
      list: vi.fn(async () => [
        {
          id: 'session',
          name: 'Chat',
          workingDirectory: '/project',
          createdAt: 'created',
          updatedAt: 'updated',
          model: 'direct-Exact/ID',
          providerId: 'endpoint-a',
          executionEnvironment: binding,
        },
      ]),
      loadMessages: vi.fn(async () => []),
    };
    const service = new SessionApplicationService(
      repository as unknown as SessionMetadataRepository,
      {} as never,
      {} as never,
      {} as never
    );
    const response = await service.list(false);
    expect(repository.list).toHaveBeenCalledWith(false);
    expect(repository.loadMessages).toHaveBeenCalledWith('session');
    expect(response).toEqual({
      success: true,
      sessions: [
        expect.objectContaining({
          model: 'direct-Exact/ID',
          providerId: 'endpoint-a',
          executionEnvironment: binding,
        }),
      ],
    });
    expect(response.sessions[0].executionEnvironment).toBe(binding);
  });
});
