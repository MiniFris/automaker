import { describe, expect, it, vi } from 'vitest';
import { WorktreeProcessService } from '../../../src/modules/worktree/worktree-process.service.js';

function fixture(options?: { target?: unknown }) {
  const settings = {
    getProjectSettings: vi.fn().mockResolvedValue({
      devCommand: 'npm run dev',
      testCommand: 'npm test',
    }),
  };
  const git = { resolve: vi.fn().mockResolvedValue(options?.target) };
  const localDev = {
    isRunning: vi.fn().mockReturnValue(false),
    startDevServer: vi.fn().mockResolvedValue({
      success: true,
      result: { worktreePath: '/project', port: 3100, url: 'http://localhost:3100' },
    }),
    stopDevServer: vi.fn(),
    listDevServers: vi.fn().mockReturnValue({ result: { servers: [] } }),
    getServerLogs: vi.fn(),
  };
  const localTests = {
    getActiveSession: vi.fn(),
    startTests: vi.fn().mockResolvedValue({
      success: true,
      result: { sessionId: 'local-test', status: 'running' },
    }),
    stopTests: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn().mockReturnValue({ result: { sessions: [] } }),
    getSessionOutput: vi.fn(),
  };
  const service = new WorktreeProcessService(
    settings as never,
    git as never,
    { find: vi.fn(), list: vi.fn().mockReturnValue([]) } as never,
    { find: vi.fn(), get: vi.fn(), list: vi.fn().mockReturnValue([]) } as never,
    localDev as never,
    localTests as never
  );
  return { service, settings, git, localDev, localTests };
}

describe('WorktreeProcessService', () => {
  it('uses the configured command only after resolving a Local dev target', async () => {
    const { service, settings, git, localDev } = fixture();

    await expect(
      service.startDev({ projectPath: '/project', worktreePath: '/project' })
    ).resolves.toMatchObject({ success: true, result: { port: 3100 } });

    expect(git.resolve).toHaveBeenCalledWith('/project');
    expect(settings.getProjectSettings).toHaveBeenCalledWith('/project');
    expect(localDev.startDevServer).toHaveBeenCalledWith('/project', '/project', 'npm run dev');
  });

  it('rejects stale managed identity instead of starting a Local process', async () => {
    const { service, localDev } = fixture();

    await expect(
      service.startDev({
        projectPath: '/project',
        worktreePath: '/project',
        environmentTargetId: 'stale-target',
      })
    ).rejects.toMatchObject({ code: 'DEV_TARGET_CHANGED' });
    expect(localDev.startDevServer).not.toHaveBeenCalled();
  });

  it('starts Local tests with project settings and an optional relative test file', async () => {
    const { service, localTests } = fixture();

    await expect(
      service.startTests({
        projectPath: '/project',
        worktreePath: '/project/worktree',
        testFile: 'tests/example.test.ts',
      })
    ).resolves.toMatchObject({ success: true, result: { sessionId: 'local-test' } });

    expect(localTests.startTests).toHaveBeenCalledWith('/project/worktree', {
      command: 'npm test',
      testFile: 'tests/example.test.ts',
    });
  });
});
