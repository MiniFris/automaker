import { beforeEach, it, expect } from 'vitest';
import { useTestRunnersStore } from '@/store/test-runners-store';
import type { ProjectGitEnvironment } from '@automaker/types';

const environment: ProjectGitEnvironment = {
  type: 'ssh',
  projectPath: '/p',
  path: '/p',
  runtimeCwd: '/remote/p',
  root: '/remote/p',
  targetId: 'a'.repeat(64),
  pinned: true,
};
const session = {
  sessionId: 'managed-test-one',
  worktreePath: '/p',
  command: 'npm test',
  status: 'running' as const,
  startedAt: new Date().toISOString(),
  executionEnvironment: environment,
};
beforeEach(() => useTestRunnersStore.getState().reset());
it('keeps the target and accumulated logs across duplicate start/snapshot events', () => {
  const store = useTestRunnersStore.getState();
  store.startSession(session);
  store.appendOutput(session.sessionId, 'TARGET_OUTPUT');
  store.startSession(session);
  expect(store.getSession(session.sessionId)?.output).toBe('TARGET_OUTPUT');
  expect(store.getSession(session.sessionId)?.executionEnvironment).toEqual(environment);
});
it('does not resurrect a fast completed run when its slow HTTP start response arrives', () => {
  const store = useTestRunnersStore.getState();
  store.startSession(session);
  store.completeSession(session.sessionId, 'passed', 0, 10);
  store.startSession(session);
  expect(store.getSession(session.sessionId)?.status).toBe('passed');
  expect(store.isWorktreeRunning('/p')).toBe(false);
  expect(store.getActiveSession('/p')).toBeNull();
});
it('does not remove a newer active session when an older completed snapshot arrives', () => {
  const store = useTestRunnersStore.getState();
  store.startSession({ ...session, status: 'passed' });
  store.startSession({ ...session, sessionId: 'managed-test-new' });
  store.startSession({ ...session, status: 'passed' });
  expect(store.getActiveSession('/p')?.sessionId).toBe('managed-test-new');
});
it('bounds client-side log retention', () => {
  const store = useTestRunnersStore.getState();
  store.startSession(session);
  store.appendOutput(session.sessionId, 'x'.repeat(100000) + 'FINAL_TAIL');
  expect(store.getSession(session.sessionId)?.output.length).toBe(50000);
  expect(store.getSession(session.sessionId)?.output).toContain('FINAL_TAIL');
});
