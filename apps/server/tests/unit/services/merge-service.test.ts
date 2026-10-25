import { expect, it, vi } from 'vitest';
import { performMerge, isMissingGitRepository } from '../../../src/services/merge-service.js';
import { ExecutionEnvironmentError } from '../../../src/services/execution-environment/runtime.js';

it.each(['rev-parse', 'fetch', 'merge', 'diff', 'status', 'commit'])(
  'preserves typed cleanup uncertainty from %s instead of converting it to a known result',
  async (phase) => {
    const unknown = new ExecutionEnvironmentError('PROCESS_CLEANUP_FAILED', 'Unconfirmed cleanup.');
    const emit = vi.fn();
    const execute = vi.fn(async (args: string[]) => {
      if (args[0] === phase) throw unknown;
      if (['diff', 'status'].includes(phase) && args[0] === 'merge')
        throw new Error('Known merge failure.');
      return '';
    });
    await expect(
      performMerge(
        '/project',
        'feature',
        '/worktree',
        'main',
        { squash: phase === 'commit' },
        { emit } as never,
        { signal: new AbortController().signal, execute }
      )
    ).rejects.toBe(unknown);
    expect(
      emit.mock.calls.some(([name]) =>
        ['merge:success', 'merge:conflict', 'merge:error'].includes(name)
      )
    ).toBe(false);
  }
);

it('returns only real Git-wrapper stdout and refuses truncated query output', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createLocalMergeExecutor } = await import('../../../src/services/merge-service.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-command-output-'));
  try {
    await fs.writeFile(
      path.join(root, 'git'),
      `#!${process.execPath}\nif(process.argv[2]==='oversized')process.stdout.write('x'.repeat(1048577));else{process.stdout.write('main\\n');process.stderr.write('private diagnostic\\n');}\n`,
      { mode: 0o700 }
    );
    const real = createLocalMergeExecutor(
      { PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_GLOBAL: '/dev/null' },
      new AbortController().signal
    );
    const absent = await real.execute(['branch', '--show-current'], root).catch((error) => error);
    expect(isMissingGitRepository(absent)).toBe(true);
    expect(isMissingGitRepository(new Error('fatal: not a git repository'))).toBe(false);
    const command = createLocalMergeExecutor({ PATH: root }, new AbortController().signal);
    await expect(command.execute(['branch', '--show-current'], root)).resolves.toBe('main\n');
    await expect(command.execute(['oversized'], root)).rejects.toThrow(
      'Git command output exceeded the safe limit.'
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
