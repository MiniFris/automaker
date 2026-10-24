import { describe, expect, it, vi } from 'vitest';
import { ChatExecutionReadModel } from '../../../src/modules/agents/chat-execution-read-model.js';
import { AgentExecutionCoordinator } from '../../../src/services/agent/agent-execution-coordinator.js';
import { AgentSessionRegistry } from '../../../src/services/agent/agent-session-registry.js';

function fixture() {
  const executions = new AgentExecutionCoordinator();
  const sessions = new AgentSessionRegistry();
  const loadMetadata = vi
    .fn()
    .mockResolvedValue({
      chat: {
        id: 'chat',
        name: 'Named chat',
        projectPath: '/project',
        workingDirectory: '/worktree',
        model: 'sonnet',
        sdkSessionId: 'private-sdk',
      },
    });
  const model = new ChatExecutionReadModel(sessions, { loadMetadata } as never, executions);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = (selected = true) =>
    executions.run('chat', async (controller) => {
      if (selected) executions.markSelected('chat', controller);
      await gate;
    });
  return { executions, sessions, loadMetadata, model, release: () => release(), run };
}
describe('chat execution read model', () => {
  it('does not read storage or resurrect persisted sessions when no live run exists', async () => {
    const f = fixture();
    expect(await f.model.list()).toEqual([]);
    expect(f.loadMetadata).not.toHaveBeenCalled();
  });
  it('includes selected preparation before hydration, without exposing prompt/history/SDK data', async () => {
    const f = fixture();
    const task = f.run();
    try {
      await Promise.resolve();
      expect(await f.model.list()).toEqual([
        {
          kind: 'chat',
          sessionId: 'chat',
          featureId: 'chat:chat',
          projectPath: '/project',
          projectName: 'project',
          workingDirectory: '/worktree',
          isAutoMode: false,
          title: 'Named chat',
          model: 'sonnet',
          provider: undefined,
        },
      ]);
    } finally {
      f.release();
      await task;
    }
  });
  it('keeps a cancelled lease visible through cleanup even when runtime running flag is false', async () => {
    const f = fixture();
    f.sessions.set('chat', {
      messages: [{ id: 'secret', role: 'user', content: 'private prompt', timestamp: 'now' }],
      promptQueue: [],
      isRunning: false,
      abortController: null,
      workingDirectory: '/active-worktree',
      projectPath: '/project',
      model: 'active-model',
      providerId: 'endpoint',
    });
    const task = f.run();
    try {
      await Promise.resolve();
      f.executions.abortAll();
      expect(await f.model.list()).toMatchObject([
        { model: 'active-model', provider: 'endpoint', workingDirectory: '/active-worktree' },
      ]);
      expect(JSON.stringify(await f.model.list())).not.toContain('private prompt');
    } finally {
      f.release();
      await task;
    }
    expect(await f.model.list()).toEqual([]);
  });
  it('drops a completed lease after delayed metadata I/O', async () => {
    const f = fixture();
    let finishRead!: (value: object) => void;
    f.loadMetadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    const task = f.run();
    await Promise.resolve();
    const listing = f.model.list();
    f.release();
    await task;
    finishRead({ chat: { workingDirectory: '/project' } });
    expect(await listing).toEqual([]);
  });
  it('does not expose an unselected no-op queue lease', async () => {
    const f = fixture();
    const task = f.run(false);
    try {
      await Promise.resolve();
      expect(await f.model.list()).toEqual([]);
    } finally {
      f.release();
      await task;
    }
  });
  it('propagates storage failure instead of claiming there are no running chats', async () => {
    const f = fixture();
    const task = f.run();
    f.loadMetadata.mockRejectedValueOnce(new Error('Storage unavailable'));
    try {
      await Promise.resolve();
      await expect(f.model.list()).rejects.toThrow('Storage unavailable');
    } finally {
      f.release();
      await task;
    }
  });
});
