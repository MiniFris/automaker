import { describe, expect, it, vi } from 'vitest';
import { GitApplicationService } from '@/modules/git/git-application.service.js';

describe('GitApplicationService', () => {
  it('dispatches reads to the resolved runtime without mutation serialization', async () => {
    const target = {
      runtime: { type: 'local' },
      environment: { projectPath: '/project', targetId: 'target' },
    };
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    const service = new GitApplicationService(
      git as never,
      {
        isProjectRunning: vi.fn(),
      } as never
    );
    const signal = new AbortController().signal;

    await expect(service.diffs({ projectPath: '/project' }, signal)).resolves.toEqual({
      success: true,
    });
    expect(git.run).toHaveBeenCalledWith(target, 'diffs', { projectPath: '/project' }, signal);
  });

  it('pins local writes to the resolved target and rejects a busy project', async () => {
    const target = {
      runtime: { type: 'local' },
      environment: { projectPath: '/project', targetId: 'local-target' },
    };
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn(),
    };
    const autoMode = { isProjectRunning: vi.fn().mockResolvedValue(true) };
    const service = new GitApplicationService(git as never, autoMode as never);

    await expect(
      service.stageFiles(
        { projectPath: '/project', files: ['file.ts'], operation: 'stage' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'GIT_PROJECT_BUSY' });
    expect(git.run).not.toHaveBeenCalled();
  });
});
