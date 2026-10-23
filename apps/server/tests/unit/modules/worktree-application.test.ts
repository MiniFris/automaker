import { describe, expect, it, vi } from 'vitest';
import { WorktreeApplicationService } from '../../../src/modules/worktree/worktree-application.service.js';

const target = {
  environment: { type: 'local', projectPath: '/project', targetId: 'target' },
};

describe('WorktreeApplicationService', () => {
  it('resolves feature reads on their immutable execution target', async () => {
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    const service = new WorktreeApplicationService(
      git as never,
      { emit: vi.fn() } as never,
      { isProjectRunning: vi.fn().mockResolvedValue(false) } as never
    );
    const signal = new AbortController().signal;

    await service.diffs(
      { projectPath: '/project', featureId: 'feature/one', useWorktrees: true },
      signal
    );

    expect(git.resolveOrLocal).toHaveBeenCalledWith('/project', 'feature/one');
    expect(git.run).toHaveBeenCalledWith(
      target,
      'diffs',
      { projectPath: '/project', featureId: 'feature/one', useWorktrees: true },
      signal
    );
  });

  it('does not resolve a feature worktree when worktrees are disabled', async () => {
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    const service = new WorktreeApplicationService(
      git as never,
      { emit: vi.fn() } as never,
      { isProjectRunning: vi.fn().mockResolvedValue(false) } as never
    );

    await service.diffs(
      { projectPath: '/project', featureId: 'feature/one', useWorktrees: false },
      new AbortController().signal
    );

    expect(git.resolveOrLocal).toHaveBeenCalledWith('/project', undefined);
  });

  it('emits the established commit-log lifecycle around target execution', async () => {
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn().mockResolvedValue({
        success: true,
        result: { branch: 'main', commits: [], total: 0 },
      }),
    };
    const events = { emit: vi.fn() };
    const service = new WorktreeApplicationService(
      git as never,
      events as never,
      { isProjectRunning: vi.fn().mockResolvedValue(false) } as never
    );

    await service.commitLog({ worktreePath: '/project', limit: 20 }, new AbortController().signal);

    expect(events.emit.mock.calls.map(([name]) => name)).toEqual([
      'commitLog:start',
      'commitLog:progress',
      'commitLog:complete',
    ]);
  });

  it('serializes writes and refuses them while the project is active', async () => {
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn(),
    };
    const service = new WorktreeApplicationService(
      git as never,
      { emit: vi.fn() } as never,
      { isProjectRunning: vi.fn().mockResolvedValue(true) } as never
    );

    await expect(
      service.commit({ worktreePath: '/project', message: 'blocked' }, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'GIT_PROJECT_BUSY' });
    expect(git.run).not.toHaveBeenCalled();
  });

  it('emits cherry-pick lifecycle events around target execution', async () => {
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn().mockResolvedValue({
        success: true,
        result: { cherryPicked: true, branch: 'main', hasConflicts: false },
      }),
    };
    const events = { emit: vi.fn() };
    const service = new WorktreeApplicationService(
      git as never,
      events as never,
      { isProjectRunning: vi.fn().mockResolvedValue(false) } as never
    );

    await service.cherryPick(
      { worktreePath: '/project', commitHashes: ['abcd'] },
      new AbortController().signal
    );

    expect(events.emit.mock.calls.map(([name]) => name)).toEqual([
      'cherry-pick:started',
      'cherry-pick:success',
    ]);
  });

  it('keeps the merge response contract and emits its lifecycle', async () => {
    const git = {
      resolveOrLocal: vi.fn().mockResolvedValue(target),
      run: vi.fn().mockResolvedValue({
        success: true,
        result: { mergedBranch: 'feature/one', targetBranch: 'main', hasConflicts: false },
      }),
    };
    const events = { emit: vi.fn() };
    const service = new WorktreeApplicationService(
      git as never,
      events as never,
      { isProjectRunning: vi.fn().mockResolvedValue(false) } as never
    );

    const response = await service.merge(
      {
        projectPath: '/project',
        worktreePath: '/project/.worktrees/one',
        branchName: 'feature/one',
        targetBranch: 'main',
      },
      new AbortController().signal
    );

    expect(response).toMatchObject({
      success: true,
      mergedBranch: 'feature/one',
      targetBranch: 'main',
    });
    expect(events.emit.mock.calls.map(([name]) => name)).toEqual(['merge:start', 'merge:success']);
  });
});
