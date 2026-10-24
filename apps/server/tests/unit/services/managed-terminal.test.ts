import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pty from 'node-pty';
import { SettingsService } from '@/services/settings-service.js';
import { TerminalService } from '@/services/terminal-service.js';
import * as terminalModule from '@/services/terminal-service.js';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createTerminalRoutes } from '@/routes/terminal/index.js';
import { addToken, deleteToken } from '@/routes/terminal/common.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { ProjectGitService, workspaceAlias } from '@/services/execution-environment/project-git.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    throw Error('Controller PTY must never start');
  }),
}));
const exec = promisify(execFile);
describe.skipIf(process.platform !== 'linux')('managed interactive terminal on real SSH', () => {
  let root: string, project: string, checkout: string, settings: SettingsService;
  let peer: Awaited<ReturnType<typeof sshPeer>>, terminals: TerminalService;
  let targetEnv: Record<string, string>;
  let unknownCleanup = false;
  const active = () => new AbortController().signal;
  beforeEach(async () => {
    unknownCleanup = false;
    root = await fs.mkdtemp(path.join(os.tmpdir(), "managed-terminal-'"));
    project = path.join(root, 'controller');
    checkout = path.join(root, 'target');
    await fs.mkdir(project);
    await fs.mkdir(checkout);
    await exec('git', ['-C', checkout, 'init', '-qb', 'main']);
    await fs.writeFile(path.join(checkout, '.gitignore'), '.automaker/\n.worktrees/\n*.pid\n');
    await exec('git', ['-C', checkout, 'add', '.']);
    await exec('git', [
      '-C',
      checkout,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'base',
    ]);
    const key = testSSHKey();
    targetEnv = {};
    peer = await sshPeer(path.join(root, 'ssh'), key, undefined, 0, targetEnv);
    const profile = {
      id: 'ssh',
      name: 'SSH',
      type: 'ssh' as const,
      host: '127.0.0.1',
      port: peer.port,
      username: 'developer',
      basePath: path.join(root, 'ssh', 'base'),
      credentialId: 'key',
    };
    settings = new SettingsService(path.join(root, 'data'));
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'profile', profileId: 'ssh' }, profiles: [profile] },
    });
    const manager = new ManagedSSH(settings);
    const host = await manager.state.scan(profile);
    await manager.state.confirm(profile, host.fingerprint, false);
    await manager.state.saveKey('key', key);
    await manager.prepareProject(
      profile,
      project,
      { method: 'existing', remotePath: checkout },
      active()
    );
    terminals = new TerminalService(settings);
    vi.stubEnv('AUTOMAKER_API_KEY', 'controller-only-test-secret');
  }, 15000);
  afterEach(async () => {
    try {
      if (unknownCleanup)
        await expect(terminals.cleanup()).rejects.toMatchObject({
          code: 'TERMINAL_CLEANUP_FAILED',
        });
      else await terminals?.cleanup();
    } finally {
      await peer?.close();
      await fs.rm(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
  const create = async (cwd = project) => {
    const target = (await new ProjectGitService(settings).resolve(cwd))!;
    return (await terminals.createSession({
      cwd,
      cols: 80,
      rows: 24,
      environmentTargetId: target.environment.targetId,
    }))!;
  };
  it('requires the inspected target before dispatch and never invokes controller node-pty', async () => {
    const before = peer.commands.length;
    await expect(terminals.createSession({ cwd: project })).rejects.toMatchObject({
      code: 'TERMINAL_TARGET_CHANGED',
    });
    expect(peer.commands).toHaveLength(before);
    expect(pty.spawn).not.toHaveBeenCalled();
  });
  it(
    'authenticates REST sessions, exposes immutable runtime metadata, resizes and stops without recreating missing sessions',
    { timeout: 20000 },
    async () => {
      vi.spyOn(terminalModule, 'getTerminalService').mockReturnValue(terminals);
      vi.stubEnv('TERMINAL_PASSWORD', 'fixture');
      addToken('fixture-token', { createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
      const app = express();
      app.use(express.json());
      app.use('/terminal', createTerminalRoutes());
      const server = createServer(app);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/terminal`;
      const headers = { 'Content-Type': 'application/json', 'X-Terminal-Token': 'fixture-token' };
      try {
        expect((await fetch(url + '/sessions')).status).toBe(401);
        const target = (await new ProjectGitService(settings).resolve(project))!;
        const bad = await fetch(url + '/sessions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ cwd: project }),
        });
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('TERMINAL_TARGET_CHANGED');
        const response = await fetch(url + '/sessions', {
          method: 'POST',
          headers,
          body: JSON.stringify({ cwd: project, environmentTargetId: target.environment.targetId }),
        });
        expect(response.status).toBe(200);
        const created = (await response.json()).data;
        expect(created.executionEnvironment).toMatchObject({ type: 'ssh', runtimeCwd: checkout });
        const get = await fetch(url + '/sessions/' + created.id, { headers });
        expect((await get.json()).data.executionEnvironment).toEqual(created.executionEnvironment);
        expect(
          (
            await fetch(url + '/sessions/' + created.id + '/resize', {
              method: 'POST',
              headers,
              body: JSON.stringify({ cols: 99, rows: 33 }),
            })
          ).status
        ).toBe(200);
        expect(
          (
            await fetch(url + '/sessions/' + created.id + '/resize', {
              method: 'POST',
              headers,
              body: JSON.stringify({ cols: '99', rows: -1 }),
            })
          ).status
        ).toBe(400);
        expect(
          (await fetch(url + '/sessions/' + created.id, { method: 'DELETE', headers })).status
        ).toBe(200);
        await vi.waitFor(() => expect(terminals.getSessionCount()).toBe(0));
        expect((await fetch(url + '/sessions/' + created.id, { headers })).status).toBe(404);
        expect(terminals.getSessionCount()).toBe(0);
        expect(pty.spawn).not.toHaveBeenCalled();
      } finally {
        deleteToken('fixture-token');
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );
  it('grants the startup command only once for a terminal regardless of reconnects', async () => {
    const session = await create();
    expect(terminalModule.claimTerminalStartup(session)).toBe(true);
    expect(terminalModule.claimTerminalStartup(session)).toBe(false);
    expect(terminalModule.claimTerminalStartup(session)).toBe(false);
    terminals.killSession(session.id);
  });
  it(
    'streams input/output, resizes and reconnects to the same shell after default changes',
    { timeout: 20000 },
    async () => {
      const session = await create();
      expect(session.executionEnvironment).toMatchObject({ type: 'ssh', runtimeCwd: checkout });
      terminals.write(
        session.id,
        "test -t 0 && printf 'REMOTE_TTY_OK\\n'; printf '%s\\n' \"$AUTOMAKER_API_KEY\"; echo once >> effects\n"
      );
      await vi.waitFor(() => expect(session.scrollbackBuffer).toContain('REMOTE_TTY_OK\r\n'));
      expect(session.scrollbackBuffer).not.toContain('controller-only-test-secret');
      terminals.resize(session.id, 121, 37);
      terminals.write(session.id, 'stty size\n');
      await vi.waitFor(() => expect(session.scrollbackBuffer).toContain('37 121'));
      const binding = session.executionEnvironment;
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      expect(terminals.getSession(session.id)?.executionEnvironment).toBe(binding);
      expect(terminals.getScrollbackAndClearPending(session.id)).toContain('REMOTE_TTY_OK');
      terminals.write(session.id, "printf 'STILL_REMOTE\\n'\n");
      await vi.waitFor(() => expect(session.scrollbackBuffer).toContain('STILL_REMOTE\r\n'));
      expect(await fs.readFile(path.join(checkout, 'effects'), 'utf8')).toBe('once\n');
      await expect(fs.stat(path.join(project, 'effects'))).rejects.toThrow();
      expect(terminals.killSession(session.id)).toBe(true);
      await vi.waitFor(() => expect(terminals.getSession(session.id)).toBeUndefined());
      expect(pty.spawn).not.toHaveBeenCalled();
    }
  );
  it(
    'opens an old pinned feature alias on SSH after its profile/default was removed',
    { timeout: 20000 },
    async () => {
      const run = (await new FeatureWorkspaceService(settings).prepare(
        project,
        { id: 'feature', model: 'cursor-auto', branchName: 'main' },
        active()
      ))!;
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const session = await create(workspaceAlias(run.binding)!);
      expect(session.cwd).toBe(run.environment.cwd);
      terminals.write(session.id, 'printf pinned > result.txt\n');
      await vi.waitFor(async () =>
        expect(await fs.readFile(path.join(run.environment.cwd, 'result.txt'), 'utf8')).toBe(
          'pinned'
        )
      );
      await expect(fs.stat(path.join(project, 'result.txt'))).rejects.toThrow();
      terminals.killSession(session.id);
    }
  );
  it(
    'reports lost transport without replay/fallback and cleans its target jobs',
    { timeout: 20000 },
    async () => {
      const session = await create();
      const output: string[] = [];
      const exits: number[] = [];
      terminals.onData((_id, data) => output.push(data));
      terminals.onExit((_id, code) => exits.push(code));
      terminals.write(session.id, 'echo once >> effects; sleep 60 & echo $! > background.pid\n');
      await vi.waitFor(async () =>
        expect(await fs.readFile(path.join(checkout, 'background.pid'), 'utf8')).toMatch(/\d+/)
      );
      const pid = Number(await fs.readFile(path.join(checkout, 'background.pid'), 'utf8'));
      peer.disconnect();
      unknownCleanup = true;
      await vi.waitFor(() => expect(exits).toEqual([255]));
      await vi.waitFor(async () => {
        await expect(fs.stat(`/proc/${pid}`)).rejects.toMatchObject({ code: 'ENOENT' });
      });
      expect(output.join('')).toContain('commands were not replayed');
      expect(terminals.getSession(session.id)).toBe(session);
      expect(await fs.readFile(path.join(checkout, 'effects'), 'utf8')).toBe('once\n');
      expect(pty.spawn).not.toHaveBeenCalled();
    }
  );
  it(
    'refuses unsupported custom shells and missing Python without controller fallback',
    { timeout: 15000 },
    async () => {
      const target = (await new ProjectGitService(settings).resolve(project))!;
      await expect(
        terminals.createSession({
          cwd: project,
          environmentTargetId: target.environment.targetId,
          shell: '/tmp/shell',
        })
      ).rejects.toMatchObject({ code: 'TERMINAL_TARGET_FAILED' });
      const bin = path.join(root, 'bin');
      await fs.mkdir(bin);
      await fs.symlink(process.execPath, path.join(bin, 'node'));
      await fs.symlink('/usr/bin/git', path.join(bin, 'git'));
      targetEnv.PATH = bin;
      await expect(create()).rejects.toMatchObject({ code: 'TERMINAL_TARGET_FAILED' });
      expect(pty.spawn).not.toHaveBeenCalled();
      expect(terminals.getSessionCount()).toBe(0);
    }
  );
});
