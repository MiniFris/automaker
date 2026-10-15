import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadOnlyWorkspace, textHash } from '@/providers/openai-compatible/workspace.js';
import { ToolRegistry } from '@/providers/openai-compatible/tool-registry.js';

const exec = promisify(execFile);
// Explicit opt-in, immutable LOCAL image. Tests never pull/build images or use real APIs.
const image = process.env.DIRECT_AGENT_DOCKER_TEST_IMAGE;
describe.skipIf(process.platform !== 'linux' || !image)(
  'direct shell / real offline Docker sandbox',
  () => {
    let temporary: string;
    let root: string;
    let workspace: ReadOnlyWorkspace;
    let registry: ToolRegistry;

    function tools(readOnly = false) {
      return new ToolRegistry(workspace, ['Bash'], readOnly, {
        access: 'workspace-write',
        shell: { backend: 'docker', image: image! },
      });
    }
    async function call(command: string, signal = new AbortController().signal, cwd?: string) {
      const result = await registry.execute(
        {
          id: 'shell-call',
          type: 'function',
          function: { name: 'Bash', arguments: JSON.stringify({ command, ...(cwd && { cwd }) }) },
        },
        signal
      );
      return JSON.parse(result.content);
    }
    beforeEach(async () => {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'direct-shell-test-'));
      root = path.join(temporary, 'project');
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, 'answer.txt'), '41\n');
      await fs.writeFile(path.join(root, 'test.sh'), '[ "$(cat answer.txt)" = "42" ]');
      workspace = await ReadOnlyWorkspace.create(root);
      registry = tools();
    });
    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await fs.rm(temporary, { recursive: true, force: true });
    });

    it('changes text, runs tests and returns a Git diff in a separate worktree', async () => {
      const repository = path.join(temporary, 'repository');
      await exec('git', ['init', repository]);
      await fs.writeFile(path.join(repository, 'answer.txt'), '41\n');
      await fs.writeFile(path.join(repository, 'test.sh'), '[ "$(cat answer.txt)" = "42" ]');
      await exec('git', ['-C', repository, 'add', '.']);
      await exec('git', [
        '-C',
        repository,
        '-c',
        'user.name=Direct Test',
        '-c',
        'user.email=direct@test.invalid',
        'commit',
        '-m',
        'fixture',
      ]);
      const worktree = path.join(temporary, 'worktree');
      await exec('git', ['-C', repository, 'worktree', 'add', '--detach', worktree]);
      workspace = await ReadOnlyWorkspace.create(worktree);
      registry = tools();
      const result = await call('printf "42\\n" > answer.txt; sh test.sh && echo tests-passed');
      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        result: { exitCode: 0, output: 'tests-passed\n', changedFiles: ['answer.txt'] },
      });
      const diff = await exec('git', ['-C', worktree, 'diff', '--', 'answer.txt']);
      expect(diff.stdout).toContain('-41\n+42');
      expect(await fs.readFile(path.join(repository, 'answer.txt'), 'utf8')).toBe('41\n');
    }, 20_000);

    it('cannot see host files, endpoint env, Docker socket or protected metadata', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'private-key-that-must-not-reach-container');
      vi.stubEnv('DOCKER_HOST', 'tcp://must-not-be-used.invalid:1234');
      await fs.mkdir(path.join(root, '.automaker'));
      await fs.writeFile(path.join(root, '.automaker', 'credentials.json'), 'server-private');
      await fs.writeFile(path.join(root, '.git'), 'gitdir: /host/metadata');
      const outside = path.join(temporary, 'outside-secret.txt');
      await fs.writeFile(outside, 'outside-private');
      await fs.symlink(outside, path.join(root, 'escape.txt'));
      const result = await call(
        `set -e; test ! -e '${outside}'; test ! -e /var/run/docker.sock; test ! -e /workspace/.git; test ! -e /workspace/.automaker; test ! -e /workspace/escape.txt; test -z "$OPENAI_API_KEY"; test -z "$DOCKER_HOST"; grep -q 'CapEff:[[:space:]]*0000000000000000' /proc/self/status; grep -q 'NoNewPrivs:[[:space:]]*1' /proc/self/status; echo isolated`
      );
      expect(result).toMatchObject({ ok: true, result: { exitCode: 0, output: 'isolated\n' } });
      expect(JSON.stringify(result)).not.toContain('private-key-that');
    }, 20_000);

    it('uses a truly read-only workspace and never imports writes in read-only mode', async () => {
      registry = tools(true);
      expect(await call('printf bad > answer.txt')).toMatchObject({
        ok: true,
        result: { changedFiles: [] },
      });
      expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).toBe('41\n');
    }, 20_000);

    it('imports new directories and retains edits made before a failed test', async () => {
      const result = await call(
        'mkdir -p src/sub; printf hello > src/sub/new.txt; printf "42\\n" > answer.txt; exit 7'
      );
      expect(result).toMatchObject({
        ok: true,
        result: {
          exitCode: 7,
          changedFiles: expect.arrayContaining(['answer.txt', 'src/sub/new.txt']),
        },
      });
      expect(await fs.readFile(path.join(root, 'src/sub/new.txt'), 'utf8')).toBe('hello');
    }, 20_000);

    it.each([
      'ln -s /etc/passwd escape.txt',
      'ln answer.txt hardlink.txt',
      'mkdir .git; printf bad > .git/config',
      'rm answer.txt',
      'printf "\\000" > binary.txt',
    ])(
      'rejects unsafe exports without importing any edits (%s)',
      async (command) => {
        const result = await call(`printf "42\\n" > answer.txt; ${command}`);
        expect(result.ok).toBe(false);
        expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).toBe('41\n');
      },
      20_000
    );

    it('denies host/parent cwd before starting a command', async () => {
      expect(await call('echo unsafe', undefined, '..')).toMatchObject({
        ok: false,
        error: { code: 'PATH_DENIED' },
      });
    });

    it('detects a concurrent host edit instead of overwriting it', async () => {
      const operation = call('printf "42\\n" > answer.txt; sleep 1');
      await delay(300);
      await fs.writeFile(path.join(root, 'answer.txt'), 'host edit\n');
      expect(await operation).toMatchObject({ ok: false, error: { code: 'FILE_CONFLICT' } });
      expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).toBe('host edit\n');
    }, 20_000);

    it('bounds output while draining the process and leaves no container behind', async () => {
      const result = await call('yes x | head -c 50000');
      expect(result.ok).toBe(true);
      expect(result.result.truncated).toBe(true);
      expect(result.result.output.length).toBeLessThanOrEqual(8000);
      const containers = await exec('/usr/bin/docker', [
        'ps',
        '-aq',
        '--filter',
        `label=automaker.direct.workspace=${textHash(workspace.root)}`,
      ]);
      expect(containers.stdout.trim()).toBe('');
    }, 20_000);

    it('cancels the whole container including detached grandchildren, and discards its writes', async () => {
      const controller = new AbortController();
      const operation = call(
        'printf "42\\n" > answer.txt; (sleep 120 &) ; sleep 120',
        controller.signal
      );
      // Ensure cancellation reaches real descendants, not merely container startup.
      let started = false;
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const listed = await exec('/usr/bin/docker', [
            'ps',
            '--filter',
            `label=automaker.direct.workspace=${textHash(workspace.root)}`,
            '--format',
            '{{.Names}}',
          ]);
          if (listed.stdout.trim()) {
            const top = await exec('/usr/bin/docker', [
              'top',
              listed.stdout.trim(),
              '-eo',
              'pid,args',
            ]);
            if (
              top.stdout.split('\n').filter((line) => /^\s*\d+\s+sleep 120\s*$/.test(line))
                .length >= 2
            ) {
              started = true;
              break;
            }
          }
          await delay(25);
        }
      } finally {
        controller.abort();
      }
      await expect(operation).rejects.toThrow('cancelled');
      expect(started).toBe(true);
      expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).toBe('41\n');
      const containers = await exec('/usr/bin/docker', [
        'ps',
        '-aq',
        '--filter',
        `label=automaker.direct.workspace=${textHash(workspace.root)}`,
      ]);
      expect(containers.stdout.trim()).toBe('');
    }, 20_000);

    it('fails closed for an unavailable immutable image, without pulling it', async () => {
      registry = new ToolRegistry(workspace, ['Bash'], false, {
        access: 'workspace-write',
        shell: { backend: 'docker', image: `sha256:${'0'.repeat(64)}` },
      });
      expect(await call('printf bad > answer.txt')).toMatchObject({
        ok: false,
        error: { code: 'SANDBOX_UNAVAILABLE' },
      });
      expect(await fs.readFile(path.join(root, 'answer.txt'), 'utf8')).toBe('41\n');
    }, 20_000);
  }
);
