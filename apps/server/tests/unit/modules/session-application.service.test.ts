import { describe, expect, it, vi } from 'vitest';
import { SessionApplicationService } from '@/modules/sessions/session-application.service.js';
import type {
  ActiveSessionCoordinator,
  SessionMetadataRepository,
} from '@/modules/sessions/session-metadata.repository.js';

const metadata = {
  id: 'session-1',
  name: 'Session',
  projectPath: '/project',
  workingDirectory: '/project',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const createRepository = (): SessionMetadataRepository => ({
  list: vi.fn().mockResolvedValue([metadata]),
  loadMessages: vi.fn().mockResolvedValue([{ content: 'first' }, { content: 'last message' }]),
  create: vi.fn().mockResolvedValue(metadata),
  update: vi.fn().mockResolvedValue(metadata),
  archive: vi.fn().mockResolvedValue(true),
});

describe('SessionApplicationService', () => {
  it('combines persisted metadata with ordered conversation history', async () => {
    const repository = createRepository();
    const service = new SessionApplicationService(
      repository,
      { deleteAndRelease: vi.fn() },
      {} as never,
      {} as never
    );

    await expect(service.list(false)).resolves.toEqual({
      success: true,
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          messageCount: 2,
          preview: 'last message',
          isArchived: false,
        }),
      ],
    });
    expect(repository.list).toHaveBeenCalledWith(false);

    await expect(service.get('session-1')).resolves.toEqual({
      success: true,
      session: metadata,
      messages: [{ content: 'first' }, { content: 'last message' }],
    });
    expect(repository.list).toHaveBeenLastCalledWith(true);
  });

  it('validates both project and working directory before persistence', async () => {
    const repository = createRepository();
    const validateLocalPath = vi.fn((value: string) => `/allowed${value}`);
    const service = new SessionApplicationService(
      repository,
      { deleteAndRelease: vi.fn() },
      { validateLocalPath } as never,
      { workingDirectory: '/runtime' } as never
    );

    await service.create({ name: 'Session', projectPath: '/project' });

    expect(validateLocalPath).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/allowed/project',
        workingDirectory: '/allowed/project',
      })
    );
  });

  it('returns not-found and delegates deletion to active-session cleanup', async () => {
    const repository = createRepository();
    vi.mocked(repository.update).mockResolvedValue(null);
    const active: ActiveSessionCoordinator = { deleteAndRelease: vi.fn().mockResolvedValue(false) };
    const service = new SessionApplicationService(repository, active, {} as never, {} as never);

    await expect(service.update('missing', { name: 'New name' })).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(service.remove('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(active.deleteAndRelease).toHaveBeenCalledWith('missing');
  });
});
