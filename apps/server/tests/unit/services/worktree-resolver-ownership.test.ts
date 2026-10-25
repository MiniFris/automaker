import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionEnvironmentError } from '../../../src/services/execution-environment/runtime.js';
const control = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../src/services/merge-service.js', () => ({
  createLocalMergeExecutor: (_env: unknown, signal: AbortSignal) => ({
    execute: (args: string[], cwd: string) => control.execute(signal, args, cwd),
  }),
  isMissingGitRepository: () => false,
}));
import { WorktreeResolver } from '../../../src/services/worktree-resolver.js';
afterEach(() => {
  vi.clearAllMocks();
});
it('retains unconfirmed native query cleanup and blocks replacement even after the accepted promise settles', async () => {
  const failure = new ExecutionEnvironmentError(
    'PROCESS_CLEANUP_FAILED',
    'controlled cleanup failure'
  );
  control.execute.mockRejectedValueOnce(failure);
  const resolver = new WorktreeResolver(null, {});
  await expect(resolver.getCurrentBranch('/owned')).rejects.toBe(failure);
  expect(resolver.runtimeDiagnostics()).toEqual({ active: 1, unconfirmed: 1 });
  await expect(resolver.listWorktrees('/owned')).rejects.toThrow('cannot accept');
  const first = resolver.close();
  expect(resolver.close()).toBe(first);
  await expect(first).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
  expect(control.execute).toHaveBeenCalledTimes(1);
});
it('bounded admission rejects another native query while accepted work drains cooperatively', async () => {
  control.execute.mockImplementationOnce(
    (signal: AbortSignal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), {
          once: true,
        })
      )
  );
  const resolver = new WorktreeResolver(null, {}, { maximum: 1 });
  const accepted = resolver.getCurrentBranch('/owned').catch((error) => error);
  await vi.waitFor(() => expect(control.execute).toHaveBeenCalledTimes(1));
  await expect(resolver.findWorktreeForBranch('/owned', 'main')).rejects.toThrow('cannot accept');
  await resolver.close();
  expect(await accepted).toMatchObject({ errorCode: 'UNAVAILABLE' });
  expect(resolver.runtimeDiagnostics()).toEqual({ active: 0, unconfirmed: 0 });
});
it('failed bounded close remains failed and retains the owner when an uncooperative helper returns late', async () => {
  let finish!: (value: string) => void;
  control.execute.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const resolver = new WorktreeResolver(null, {}, { shutdownMs: 20 });
  const accepted = resolver.getCurrentBranch('/owned').catch((error) => error);
  await vi.waitFor(() => expect(control.execute).toHaveBeenCalledTimes(1));
  const closed = resolver.close();
  await expect(closed).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
  finish('late-branch\n');
  expect(await accepted).toMatchObject({ errorCode: 'UNAVAILABLE' });
  expect(resolver.runtimeDiagnostics()).toEqual({ active: 1, unconfirmed: 1 });
  expect(resolver.close()).toBe(closed);
  await expect(resolver.close()).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
});
