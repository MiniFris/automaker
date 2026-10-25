import { createNativeWorktreeHttp } from '../../helpers/native-worktree-http.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { ProjectGitService } from '@/services/execution-environment/project-git.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';
import type { SSHEnvironmentProfile } from '@automaker/types';

const execute = promisify(execFile),
  active = () => new AbortController().signal;
describe.skipIf(process.platform !== 'linux')(
  'Git UI routing on a real SSH peer and poisoned controller repo',
  () => {
    let temporary: string,
      project: string,
      remote: string,
      settings: SettingsService,
      peer: Awaited<ReturnType<typeof sshPeer>>,
      native: Awaited<ReturnType<typeof createNativeWorktreeHttp>>,
      url: string,
      busy = false,
      peerClosed = false;
    const git = (cwd: string, ...args: string[]) =>
      execute('git', ['-C', cwd, ...args]).then((r) => r.stdout.trim());
    const post = async (scope: string, action: string, body: object) => {
      const response = await fetch(url + `/api/${scope}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'native-git-fixture' },
        body: JSON.stringify(body),
      });
      return { status: response.status, ...(await response.json()) };
    };
    beforeAll(async () => {
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'git-ui-ssh-'));
      project = path.join(temporary, 'controller');
      remote = path.join(temporary, "remote checkout 'quoted");
      for (const [root, content] of [
        [project, 'CONTROLLER_MUST_NOT_LEAK'],
        [remote, 'REMOTE_SOURCE'],
      ] as const) {
        await fs.mkdir(root);
        await git(root, 'init', '-q', '-b', 'main');
        await fs.writeFile(path.join(root, '.gitignore'), '.automaker/\n.worktrees/\n');
        await fs.writeFile(path.join(root, 'source.txt'), content);
        await git(root, 'add', '.');
        await git(
          root,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-qm',
          content
        );
      }
      const key = testSSHKey();
      peer = await sshPeer(path.join(temporary, 'peer'), key);
      const profile: SSHEnvironmentProfile = {
        id: 'ssh',
        name: 'SSH',
        type: 'ssh',
        host: '127.0.0.1',
        port: peer.port,
        username: 'developer',
        basePath: path.join(temporary, 'peer', 'base'),
        credentialId: 'key',
      };
      settings = new SettingsService(path.join(temporary, 'data'));
      await settings.updateGlobalSettings({
        executionEnvironment: {
          default: { mode: 'profile', profileId: 'ssh' },
          profiles: [profile],
        },
      });
      const manager = new ManagedSSH(settings),
        host = await manager.state.scan(profile);
      await manager.state.confirm(profile, host.fingerprint, false);
      await manager.state.saveKey('key', key);
      await manager.prepareProject(
        profile,
        project,
        { method: 'existing', remotePath: remote },
        active()
      );
      native = await createNativeWorktreeHttp({
        root: temporary,
        settings,
        busy: () => busy,
        apiKey: 'native-git-fixture',
      });
      url = native.url;
    }, 20000);
    afterAll(async () => {
      await native?.close();
      if (!peerClosed) await peer?.close();
      await fs.rm(temporary, { recursive: true, force: true });
    });
    it('inspects metadata without SSH connect, checkout/worktree creation or controller Git', async () => {
      const count = peer.commands.length;
      const data = await post('git', 'environment', { projectPath: project });
      expect(data.executionEnvironment).toMatchObject({
        type: 'ssh',
        runtimeCwd: remote,
        path: project,
        pinned: false,
      });
      expect(peer.commands.length).toBe(count);
    });
    it('reads remote status/diff/details/log, not the poisoned local source', async () => {
      await fs.writeFile(path.join(remote, 'source.txt'), 'REMOTE_CHANGED\n');
      const diff = await post('git', 'diffs', { projectPath: project });
      expect(diff.success).toBe(true);
      expect(diff.diff).toContain('REMOTE_CHANGED');
      expect(diff.diff).not.toContain('CONTROLLER');
      const status = await post('git', 'enhanced-status', { projectPath: project });
      expect(status.files[0]).toMatchObject({ path: 'source.txt', isUnstaged: true });
      const details = await post('git', 'details', {
        projectPath: project,
        filePath: 'source.txt',
      });
      expect(details.details.lastCommitMessage).toBe('REMOTE_SOURCE');
      const log = await post('worktree', 'commit-log', { worktreePath: project });
      expect(log.result.commits[0].subject).toBe('REMOTE_SOURCE');
      expect(await fs.readFile(path.join(project, 'source.txt'), 'utf8')).toBe(
        'CONTROLLER_MUST_NOT_LEAK'
      );
    }, 20000);
    it('requires a matching inspected target for stage/commit and never dispatches when stale or missing', async () => {
      const before = peer.commands.length;
      for (const token of [undefined, 'f'.repeat(64)])
        expect(
          await post('worktree', 'commit', {
            worktreePath: project,
            message: 'Must not commit',
            environmentTargetId: token,
          })
        ).toMatchObject({ success: false, code: 'GIT_TARGET_CHANGED' });
      expect(peer.commands.length).toBe(before);
      const env = (await post('git', 'environment', { projectPath: project })).executionEnvironment;
      expect(
        (
          await post('git', 'stage-files', {
            projectPath: project,
            files: ['source.txt'],
            operation: 'stage',
            environmentTargetId: env.targetId,
          })
        ).success
      ).toBe(true);
      expect(
        (
          await post('worktree', 'commit', {
            worktreePath: project,
            message: 'Remote UI commit',
            environmentTargetId: env.targetId,
          })
        ).result.committed
      ).toBe(true);
      expect(await git(remote, 'log', '-1', '--format=%s')).toBe('Remote UI commit');
      expect(await git(project, 'log', '-1', '--format=%s')).toBe('CONTROLLER_MUST_NOT_LEAK');
    }, 20000);
    it('blocks mutations while project agents are active', async () => {
      busy = true;
      try {
        const env = (await post('git', 'environment', { projectPath: project }))
          .executionEnvironment;
        expect(
          await post('worktree', 'commit', {
            worktreePath: project,
            message: 'busy',
            environmentTargetId: env.targetId,
          })
        ).toMatchObject({ success: false, code: 'GIT_PROJECT_BUSY' });
      } finally {
        busy = false;
      }
    });
    it.each([
      ['push', 'GIT_TARGET_CHANGED'],
      ['pull', 'GIT_TARGET_CHANGED'],
      ['delete', 'GIT_TARGET_CHANGED'],
      ['merge', 'GIT_TARGET_CHANGED'],
      ['rebase', 'GIT_TARGET_CHANGED'],
      ['cherry-pick', 'GIT_TARGET_CHANGED'],
      ['create-pr', 'GIT_TARGET_CHANGED'],
      ['generate-commit-message', 'GIT_OPERATION_UNSUPPORTED'],
      ['start-dev', 'DEV_TARGET_CHANGED'],
      ['run-init-script', 'GIT_TARGET_CHANGED'],
      ['open-in-editor', 'HOST_INTEGRATION_UNSUPPORTED'],
    ])(
      'refuses uninspected remote %s without entering controller handlers',
      async (action, expectedCode) => {
        const before = peer.commands.length;
        const bodies: Record<string, object> = {
          push: { worktreePath: project },
          pull: { worktreePath: project },
          delete: { projectPath: project, worktreePath: project },
          merge: { projectPath: project, worktreePath: project, branchName: 'main' },
          rebase: { worktreePath: project, ontoBranch: 'main' },
          'cherry-pick': { worktreePath: project, commitHashes: ['abcd'] },
          'create-pr': { worktreePath: project },
          'generate-commit-message': { worktreePath: project },
          'start-dev': { projectPath: project, worktreePath: project },
          'run-init-script': { projectPath: project, worktreePath: project, branch: 'main' },
          'open-in-editor': { worktreePath: project },
        };
        expect(await post('worktree', action, bodies[action])).toMatchObject({
          success: false,
          code: expectedCode,
        });
        expect(peer.commands.length).toBe(before);
      }
    );
    it('creates/lists a remote UI worktree with a controller alias and queries its branch without host directories', async () => {
      const env = (await post('git', 'environment', { projectPath: project })).executionEnvironment;
      const created = await post('worktree', 'create', {
        projectPath: project,
        branchName: 'ui/new',
        baseBranch: 'main',
        environmentTargetId: env.targetId,
      });
      expect(created.success).toBe(true);
      expect(created.worktree.path).toContain(project + '/.worktrees/');
      await expect(fs.stat(created.worktree.path)).rejects.toThrow();
      const list = await post('worktree', 'list', { projectPath: project });
      expect(list.worktrees).toHaveLength(2);
      const item = list.worktrees.find((item: { branch: string }) => item.branch === 'ui/new');
      expect(item.runtimePath).toContain(remote + '/.worktrees/');
      expect(
        (await post('worktree', 'info', { projectPath: project, featureId: 'ui/new' })).worktreePath
      ).toBe(item.path);
      const described = (await post('git', 'environment', { projectPath: item.path }))
        .executionEnvironment;
      expect(described.targetId).toBe(item.executionEnvironment.targetId);
      const branches = await post('worktree', 'list-branches', {
        worktreePath: item.path,
        includeRemote: true,
      });
      expect(branches.result.currentBranch).toBe('ui/new');
    }, 20000);
    it('does not expose mutating Git actions on unregistered routes or GET methods', async () => {
      const before = peer.commands.length;
      expect(
        await post('git', 'commit', { projectPath: project, message: 'not a Git router endpoint' })
      ).toMatchObject({ status: 404 });
      const response = await fetch(
        url + '/api/worktree/commit?worktreePath=' + encodeURIComponent(project)
      );
      expect(response.status).toBe(404);
      expect(peer.commands.length).toBe(before);
    });
    it('keeps a pinned feature on SSH after defaults change, ignores useWorktrees:false and lists it in Local UI', async () => {
      const feature = { id: 'pinned', model: 'cursor-auto', branchName: 'main' };
      const run = (await new FeatureWorkspaceService(settings).prepare(
        project,
        feature,
        active()
      ))!;
      await run.environment.writeFile('pinned.txt', Buffer.from('REMOTE_PINNED'), active());
      const expected = new ProjectGitService(settings),
        target = (await expected.resolve(project, feature.id))!;
      const rootToken = (await post('git', 'environment', { projectPath: project }))
        .executionEnvironment.targetId;
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      expect(
        await post('worktree', 'commit', {
          worktreePath: project,
          message: 'Stale SSH scope',
          environmentTargetId: rootToken,
        })
      ).toMatchObject({ success: false, code: 'GIT_TARGET_CHANGED' });
      expect(await git(project, 'log', '-1', '--format=%s')).toBe('CONTROLLER_MUST_NOT_LEAK');
      const diff = await post('worktree', 'diffs', {
        projectPath: project,
        featureId: feature.id,
        useWorktrees: false,
      });
      expect(diff.success).toBe(true);
      expect(diff.diff).toContain('REMOTE_PINNED');
      expect(diff.executionEnvironment.targetId).toBe(target.environment.targetId);
      const list = await post('worktree', 'list', { projectPath: project });
      const item = list.worktrees.find(
        (item: { executionEnvironment?: { pinned: boolean } }) => item.executionEnvironment?.pinned
      );
      expect(item.executionEnvironment.type).toBe('ssh');
      expect((await post('git', 'diffs', { projectPath: item.path })).diff).toContain(
        'REMOTE_PINNED'
      );
    }, 20000);
    it('lists retired SSH pins without connecting and reports unavailable Git instead of empty/local results', async () => {
      await peer.close();
      peerClosed = true;
      const list = await post('worktree', 'list', { projectPath: project });
      expect(list.success).toBe(true);
      const pin = list.worktrees.find(
        (item: { executionEnvironment?: { pinned: boolean } }) => item.executionEnvironment?.pinned
      );
      expect(pin.executionEnvironment.type).toBe('ssh');
      const result = await post('git', 'diffs', { projectPath: pin.path });
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('diff');
      expect(await fs.readFile(path.join(project, 'source.txt'), 'utf8')).toBe(
        'CONTROLLER_MUST_NOT_LEAK'
      );
    }, 15000);
  }
);
