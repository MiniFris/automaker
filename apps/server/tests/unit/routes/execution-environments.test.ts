import { TerminalService } from '../../../src/services/terminal-service.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { createExecutionEnvironmentSettingsRoutes } from '@/routes/settings/execution-environments.js';
import { createSettingsRoutes } from '@/routes/settings/index.js';
import { ManagedDocker } from '@/services/execution-environment/docker.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { testSSHKey } from '../../helpers/ssh-peer.js';

// The legacy global-settings handler imports this entrypoint for one logging toggle.
// Do not start the real app, background services, or shared data directory in route tests.
vi.mock('@/index.js', () => ({ setRequestLoggingEnabled: vi.fn() }));

describe('execution environment settings API', () => {
  let temporary: string;
  let project: string;
  let settings: SettingsService;
  let server: Server;
  let url: string;
  const runner = vi.fn();
  let docker: ManagedDocker;
  let ssh: ManagedSSH;
  const config = {
    default: { mode: 'profile', profileId: 'docker' },
    profiles: [
      { id: 'docker', name: 'Project Docker', type: 'docker', context: 'default' },
      {
        id: 'remote',
        name: 'Remote',
        type: 'ssh',
        host: 'dev.example.com',
        username: 'developer',
        port: 22,
        basePath: '/srv/projects',
      },
    ],
  };
  async function request(route = '/inspect', body: unknown = {}, method = 'POST') {
    const res = await fetch(url + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'environment-settings-test-'));
    project = path.join(temporary, 'project');
    await fs.mkdir(project);
    settings = new SettingsService(path.join(temporary, 'data'));
    docker = new ManagedDocker(settings);
    ssh = new ManagedSSH(settings);
    vi.spyOn(docker, 'probe').mockResolvedValue({
      connection: 'available',
      containerLifecycle: 'verified',
      projectStorage: 'not-tested',
      checkedAt: new Date().toISOString(),
      message: 'Lifecycle verified',
    });
    runner.mockResolvedValue({ code: 0, stdout: '"28.0.0"', stderr: '' });
    const app = express();
    app.use(express.json());
    app.use(
      '/environments',
      createExecutionEnvironmentSettingsRoutes(settings, runner, docker, ssh)
    );
    app.use('/settings', createSettingsRoutes(settings, new TerminalService(settings)));
    server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/environments`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  it('reports local legacy default without contacting Docker', async () => {
    expect((await request()).data).toMatchObject({
      success: true,
      settings: { default: { mode: 'local' }, profiles: [] },
      projectOverride: null,
      resolved: { type: 'local', source: 'global', runtimeIntegrated: false },
    });
    expect(runner).not.toHaveBeenCalled();
    expect(docker.probe).not.toHaveBeenCalled();
  });
  async function selectSSH() {
    const sshConfig = {
      ...config,
      default: { mode: 'profile', profileId: 'remote' },
      profiles: config.profiles.map((profile) =>
        profile.type === 'ssh' ? { ...profile, credentialId: 'remote-key' } : profile
      ),
    };
    expect((await request('/global', { settings: sshConfig }, 'PUT')).status).toBe(200);
  }
  it('never connects or installs an SSH worker just by viewing/saving SSH settings', async () => {
    const scan = vi.spyOn(ssh.state, 'scan');
    const prepare = vi.spyOn(ssh, 'prepareWorker');
    const check = vi.spyOn(ssh, 'diagnose');
    await selectSSH();
    expect((await request('/inspect', { projectPath: project })).data).toMatchObject({
      resolved: { type: 'ssh', runtimeIntegrated: true },
      ssh: { hasPrivateKey: false },
    });
    expect(scan).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
  it('inspects feature binding metadata without connecting, creating a worktree or adopting request-supplied runtime', async () => {
    await selectSSH();
    const prepare = vi.spyOn(ssh, 'prepareProject');
    const scan = vi.spyOn(ssh.state, 'scan');
    expect(
      (await request('/feature/inspect', { projectPath: project, featureId: 'feature' })).data
    ).toMatchObject({ success: true, binding: null, selectedType: 'ssh' });
    expect(
      (
        await request('/feature/inspect', {
          projectPath: project,
          featureId: 'feature',
          binding: { type: 'local' },
        })
      ).status
    ).toBe(400);
    expect((await request('/feature/inspect', { projectPath: project })).status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });
  it('validates saved SSH profiles, explicit acceptance and exact fingerprints before side effects', async () => {
    await selectSSH();
    const scan = vi
      .spyOn(ssh.state, 'scan')
      .mockResolvedValue({ algorithm: 'ssh-ed25519', fingerprint: 'SHA256:' + 'a'.repeat(43) });
    const prepare = vi.spyOn(ssh, 'prepareWorker').mockResolvedValue({} as never);
    const confirm = vi.spyOn(ssh.state, 'confirm').mockResolvedValue();
    for (const [route, body] of [
      ['/ssh/scan', { profileId: 'missing' }],
      ['/ssh/scan', { profileId: 'docker' }],
      ['/ssh/scan', { profileId: 'remote', host: 'arbitrary' }],
      ['/ssh/prepare', { profileId: 'remote' }],
      ['/ssh/prepare', { profileId: 'remote', accepted: false }],
      ['/ssh/trust', { profileId: 'remote', accepted: true, fingerprint: 'bad' }],
      [
        '/ssh/trust',
        { profileId: 'remote', accepted: false, fingerprint: 'SHA256:' + 'a'.repeat(43) },
      ],
    ] as const)
      expect((await request(route, body)).status).toBe(400);
    expect(scan).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect((await request('/ssh/scan', { profileId: 'remote' })).data.hostKey.fingerprint).toBe(
      'SHA256:' + 'a'.repeat(43)
    );
    expect(
      (
        await request('/ssh/trust', {
          profileId: 'remote',
          accepted: true,
          fingerprint: 'SHA256:' + 'a'.repeat(43),
          replace: true,
        })
      ).status
    ).toBe(200);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote' }),
      'SHA256:' + 'a'.repeat(43),
      true,
      expect.any(AbortSignal)
    );
    expect((await request('/ssh/prepare', { profileId: 'remote', accepted: true })).status).toBe(
      200
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote' }),
      expect.any(AbortSignal)
    );
  });
  it('stores uploaded SSH credentials separately and never returns key material from any settings response', async () => {
    await selectSSH();
    const key = testSSHKey();
    const saved = await request('/ssh/key', { profileId: 'remote', privateKey: key });
    expect(saved.status).toBe(200);
    expect(saved.data.ssh.hasPrivateKey).toBe(true);
    expect(JSON.stringify(saved.data)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify((await request()).data)).not.toContain(key);
    expect(JSON.stringify(await settings.getGlobalSettings())).not.toContain(key);
    expect(JSON.stringify(await settings.getProjectSettings(project))).not.toContain(key);
    const file = path.join(
      settings.getDataDirectory(),
      'execution-environments',
      'ssh',
      'credentials',
      'remote-key.json'
    );
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(
      (await request('/ssh/key', { profileId: 'remote', privateKey: 'bad-private-key' })).status
    ).toBe(400);
    expect(
      (await request('/ssh/key', { profileId: 'remote', clear: true, privateKey: key })).status
    ).toBe(400);
    expect(
      (await request('/ssh/key', { profileId: 'remote', clear: true })).data.ssh.hasPrivateKey
    ).toBe(false);
  });
  it('requires a matching project selection and explicit transfer source before SSH project preparation', async () => {
    await selectSSH();
    const prepare = vi.spyOn(ssh, 'prepareProject').mockResolvedValue({} as never);
    for (const source of [
      null,
      {},
      { method: 'import', remotePath: '/tmp/anything' },
      { method: 'clone' },
      { method: 'existing' },
      { method: 'import', extra: true },
    ])
      expect(
        (
          await request('/ssh/project', {
            profileId: 'remote',
            projectPath: project,
            accepted: true,
            source,
          })
        ).status
      ).toBe(400);
    expect(
      (
        await request('/ssh/project', {
          profileId: 'remote',
          projectPath: project,
          source: { method: 'import' },
        })
      ).status
    ).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    expect(
      (
        await request('/ssh/project', {
          profileId: 'remote',
          projectPath: project,
          accepted: true,
          source: { method: 'import' },
        })
      ).status
    ).toBe(200);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote' }),
      project,
      { method: 'import' },
      expect.any(AbortSignal)
    );
    await settings.updateProjectSettings(project, { executionEnvironment: { mode: 'local' } });
    expect(
      (
        await request('/ssh/project', {
          profileId: 'remote',
          projectPath: project,
          accepted: true,
          source: { method: 'import' },
        })
      ).status
    ).toBe(400);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('requires explicit prepare acceptance and only uses saved matching Docker profiles', async () => {
    await request('/global', { settings: config }, 'PUT');
    expect(docker.probe).not.toHaveBeenCalled();
    for (const body of [
      {},
      { accepted: false },
      { accepted: true, context: 'arbitrary' },
      { accepted: true, profileId: 'remote' },
      { accepted: true, projectPath: project, profileId: 'missing' },
    ])
      expect((await request('/docker/prepare', body)).status).toBe(400);
    expect(docker.probe).not.toHaveBeenCalled();
    expect(
      (
        await request('/docker/prepare', {
          accepted: true,
          projectPath: project,
          profileId: 'docker',
        })
      ).status
    ).toBe(200);
    expect(docker.probe).toHaveBeenCalledWith(
      'default',
      await fs.realpath(project),
      expect.any(AbortSignal)
    );
    await request('/docker/prepare', { accepted: true, profileId: 'docker' });
    expect(docker.probe).toHaveBeenLastCalledWith('default', undefined, expect.any(AbortSignal));
  });
  it('keeps Auto fallback acceptance distinct from Local and validates warning versions', async () => {
    await request('/global', { settings: { default: { mode: 'auto' }, profiles: [] } }, 'PUT');
    expect((await request('/auto/confirm', { accepted: true, warningVersion: 0 })).status).toBe(
      400
    );
    expect((await request('/local/confirm', { accepted: true, warningVersion: 1 })).status).toBe(
      400
    );
    const confirmed = await request('/auto/confirm', {
      accepted: true,
      warningVersion: 1,
      projectPath: project,
    });
    expect(confirmed.data.localConsent).toMatchObject({
      confirmed: false,
      autoFallbackConfirmed: true,
      autoFallbackScope: 'project',
    });
    expect((await request()).data.localConsent.autoFallbackConfirmed).toBe(false);
    expect(
      (await request('/auto/revoke', { projectPath: project })).data.localConsent
        .autoFallbackConfirmed
    ).toBe(false);
    expect(docker.probe).not.toHaveBeenCalled();
  });
  it('requires explicit versioned acceptance, persists consent outside project settings, and revokes it', async () => {
    for (const body of [
      { accepted: false, warningVersion: 1 },
      { accepted: true, warningVersion: 0 },
      { accepted: true, warningVersion: 1, runtime: 'local' },
    ])
      expect((await request('/local/confirm', body)).status).toBe(400);
    const confirmed = await request('/local/confirm', {
      projectPath: project,
      accepted: true,
      warningVersion: 1,
    });
    expect(confirmed.data.localConsent).toMatchObject({
      confirmed: true,
      scope: 'project',
      legacy: false,
    });
    expect(confirmed.data.resolved.runtimeIntegrated).toBe(true);
    expect((await settings.getProjectSettings(project)).executionEnvironment).toEqual({
      mode: 'local',
    });
    expect(JSON.stringify(await settings.getProjectSettings(project))).not.toContain('confirmedAt');
    expect(
      (await request('/local/revoke', { projectPath: project })).data.localConsent.confirmed
    ).toBe(false);
  });
  it('does not allow confirming a selected SSH or Docker environment as Local', async () => {
    await request('/global', { settings: config }, 'PUT');
    expect((await request('/local/confirm', { accepted: true, warningVersion: 1 })).status).toBe(
      400
    );
  });
  it('is reachable through the actual settings router mount', async () => {
    const response = await fetch(
      url.replace('/environments', '/settings/execution-environments/inspect'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      resolved: { type: 'local', runtimeIntegrated: false },
    });
    expect(runner).not.toHaveBeenCalled();
  });
  it('persists profiles without touching existing global settings or credentials', async () => {
    await settings.updateGlobalSettings({ theme: 'dark' });
    await settings.updateCredentials({ apiKeys: { anthropic: 'private-existing-key' } });
    expect((await request('/global', { settings: config }, 'PUT')).data.resolved.type).toBe(
      'docker'
    );
    expect(
      (await new SettingsService(settings.getDataDirectory()).getGlobalSettings())
        .executionEnvironment
    ).toEqual(config);
    expect((await settings.getGlobalSettings()).theme).toBe('dark');
    expect((await settings.getCredentials()).apiKeys.anthropic).toBe('private-existing-key');
    expect(JSON.stringify((await request()).data)).not.toContain('private-existing-key');
  });
  it('supports project override, changing global defaults, and explicit reset to inheritance', async () => {
    await request('/global', { settings: config }, 'PUT');
    expect(
      (await request('/project', { projectPath: project, selection: { mode: 'local' } }, 'PUT'))
        .data.resolved
    ).toMatchObject({ type: 'local', source: 'project' });
    await request(
      '/global',
      { settings: { ...config, default: { mode: 'profile', profileId: 'remote' } } },
      'PUT'
    );
    expect((await request('/inspect', { projectPath: project })).data.resolved.type).toBe('local');
    expect(
      (await request('/project', { projectPath: project, selection: null }, 'PUT')).data.resolved
    ).toMatchObject({ type: 'ssh', source: 'global' });
  });
  it('does not silently downgrade an orphaned project profile', async () => {
    await request('/global', { settings: config }, 'PUT');
    await request(
      '/project',
      { projectPath: project, selection: { mode: 'profile', profileId: 'docker' } },
      'PUT'
    );
    await request('/global', { settings: { default: { mode: 'local' }, profiles: [] } }, 'PUT');
    expect((await request('/inspect', { projectPath: project })).data.resolved).toMatchObject({
      type: 'missing-profile',
      source: 'project',
    });
  });
  it('checks only saved Docker profiles, with bounded read-only args', async () => {
    await request('/global', { settings: config }, 'PUT');
    expect((await request('/docker/check', { profileId: 'docker' })).data.diagnostic).toMatchObject(
      { status: 'available', containerLifecycle: 'not-tested', projectStorage: 'not-tested' }
    );
    expect(runner.mock.calls[0][0]).toEqual([
      '--context',
      'default',
      'info',
      '--format',
      '{{json .ServerVersion}}',
    ]);
    for (const profileId of ['remote', 'missing'])
      expect((await request('/docker/check', { profileId })).status).toBe(400);
    expect((await request('/docker/check', { host: 'tcp://evil', command: 'run' })).status).toBe(
      400
    );
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it('rejects secrets, missing selection, missing project path and unknown references', async () => {
    expect(
      (await request('/global', { settings: { ...config, privateKey: 'secret' } }, 'PUT')).status
    ).toBe(400);
    expect((await request('/project', { projectPath: project }, 'PUT')).status).toBe(400);
    expect((await request('/project', { selection: null }, 'PUT')).status).toBe(400);
    expect(
      (
        await request(
          '/project',
          { projectPath: project, selection: { mode: 'profile', profileId: 'unknown' } },
          'PUT'
        )
      ).status
    ).toBe(400);
    expect((await request('/inspect', { projectPath: 12 })).status).toBe(400);
    expect((await request('/inspect', { projectPath: 'relative-project' })).status).toBe(400);
  });
  it('validates the same fields through generic SettingsService updates', async () => {
    await expect(
      settings.updateGlobalSettings({
        executionEnvironment: {
          ...config,
          profiles: [{ ...config.profiles[0], password: 'secret' }],
        } as never,
      })
    ).rejects.toThrow();
    await expect(
      settings.updateProjectSettings(project, {
        executionEnvironment: { mode: 'local', apiKey: 'secret' } as never,
      })
    ).rejects.toThrow();
  });
  it('does not make a Docker failure a successful readiness claim', async () => {
    runner.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'permission denied private-credential-fragment',
    });
    const response = await request('/docker/check');
    expect(response.status).toBe(200);
    expect(response.data.diagnostic.status).toBe('permission-denied');
    expect(JSON.stringify(response.data)).not.toContain('private-credential-fragment');
  });
});
