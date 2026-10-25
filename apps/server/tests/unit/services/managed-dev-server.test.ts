import { createNativeWorktreeHttp } from '../../helpers/native-worktree-http.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { chromium } from '@playwright/test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SettingsService } from '@/services/settings-service.js';
import { ManagedSSH } from '@/services/execution-environment/ssh.js';
import { ProjectGitService, workspaceAlias } from '@/services/execution-environment/project-git.js';
import { FeatureWorkspaceService } from '@/services/execution-environment/feature-workspace.js';
import { ManagedDevServerService } from '@/services/execution-environment/dev-server.js';
import { createEventEmitter } from '@/lib/events.js';
import { sshPeer, testSSHKey } from '../../helpers/ssh-peer.js';

const exec = promisify(execFile),
  require = createRequire(import.meta.url);
describe.skipIf(process.platform !== 'linux')('managed dev/preview on real SSH', () => {
  let native: Awaited<ReturnType<typeof createNativeWorktreeHttp>>;
  let root: string, project: string, checkout: string, settings: SettingsService;
  let peer: Awaited<ReturnType<typeof sshPeer>>, service: ManagedDevServerService;
  let server: ReturnType<typeof createServer>, api: string;
  const active = () => new AbortController().signal;
  const post = async (action: string, body: object) => {
    const response = await fetch(`${api}/worktree/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'preview-fixture-secret' },
      body: JSON.stringify(body),
    });
    return { statusCode: response.status, ...(await response.json()) };
  };
  const start = async (command = 'node dev.cjs', alias = project) => {
    await settings.updateProjectSettings(project, { devCommand: command });
    const target = (await new ProjectGitService(settings).resolve(alias))!;
    const response = await post('start-dev', {
      worktreePath: alias,
      projectPath: '/must-not-control-command-settings',
      environmentTargetId: target.environment.targetId,
    });
    expect(response.success, response.error).toBe(true);
    return response.result as ReturnType<typeof service.describe>;
  };
  const ready = async (id: string) => {
    await vi.waitFor(() => expect(service.find(undefined, id)?.ready).toBe(true), {
      timeout: 15000,
    });
    return service.describe(service.find(undefined, id)!);
  };
  const origin = (session: ReturnType<typeof service.describe>) =>
    `http://127.0.0.1:${session.port}`;
  const cookie = (session: ReturnType<typeof service.describe>) =>
    `automaker_preview_${session.port}=${new URL(session.url).hash.slice(1)}`;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "managed-preview-'"));
    project = path.join(root, 'controller');
    checkout = path.join(root, 'target');
    const script = `const fs=require('node:fs'),http=require('node:http'),{WebSocketServer}=require(${JSON.stringify(require.resolve('ws'))});
fs.appendFileSync('effects','once\\n');
const server=http.createServer((req,res)=>{res.setHeader('Set-Cookie','automaker_session=POISON; HttpOnly');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({source:fs.readFileSync('source.txt','utf8'),cwd:process.cwd(),key:process.env.AUTOMAKER_API_KEY,ci:process.env.CI,headers:req.headers}));});
const wss=new WebSocketServer({server});wss.on('connection',ws=>ws.on('message',data=>ws.send(data)));server.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('READY',process.env.PORT));`;
    for (const [cwd, source] of [
      [project, 'CONTROLLER_POISON'],
      [checkout, 'TARGET_SOURCE'],
    ]) {
      await fs.mkdir(cwd);
      await exec('git', ['-C', cwd, 'init', '-qb', 'main']);
      await fs.writeFile(path.join(cwd, 'source.txt'), source);
      await fs.writeFile(
        path.join(cwd, '.gitignore'),
        '.automaker/\n.worktrees/\neffects\nnode_modules/\n.vite-cache/\n'
      );
      await fs.writeFile(
        path.join(cwd, 'dev.cjs'),
        cwd === project ? "throw Error('Controller dev server must never run')" : script
      );
      await exec('git', ['-C', cwd, 'add', '.']);
      await exec('git', [
        '-C',
        cwd,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'base',
      ]);
    }
    const key = testSSHKey();
    peer = await sshPeer(path.join(root, 'peer'), key);
    const profile = {
      id: 'ssh',
      name: 'SSH',
      type: 'ssh' as const,
      host: '127.0.0.1',
      port: peer.port,
      username: 'developer',
      basePath: path.join(root, 'peer', 'base'),
      credentialId: 'key',
    };
    settings = new SettingsService(path.join(root, 'data'));
    await settings.updateGlobalSettings({
      executionEnvironment: { default: { mode: 'profile', profileId: 'ssh' }, profiles: [profile] },
    });
    const manager = new ManagedSSH(settings),
      host = await manager.state.scan(profile);
    await manager.state.confirm(profile, host.fingerprint, false);
    await manager.state.saveKey('key', key);
    await manager.prepareProject(
      profile,
      project,
      { method: 'existing', remotePath: checkout },
      active()
    );
    vi.stubEnv('AUTOMAKER_API_KEY', 'preview-fixture-secret');
    native = await createNativeWorktreeHttp({ root, settings, apiKey: 'preview-fixture-secret' });
    service = native.managedDev;
    server = native.server;
    api = native.url + '/api';
  }, 15000);
  afterEach(async () => {
    await native?.close();
    await peer?.close();
    await fs.rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  it('requires an inspected identity before dispatch and never recreates missing managed IDs', async () => {
    const before = peer.commands.length;
    expect((await post('start-dev', { projectPath: project, worktreePath: project })).code).toBe(
      'DEV_TARGET_CHANGED'
    );
    expect(
      (await post('stop-dev', { worktreePath: project, sessionId: 'managed-dev-missing' })).code
    ).toBe('DEV_SESSION_GONE');
    expect(peer.commands).toHaveLength(before + 0);
  });
  it(
    'forwards owned HTTP/WS, strips controller credentials and stops the original target after profile deletion',
    { timeout: 30000 },
    async () => {
      const session = await ready((await start()).sessionId);
      expect(session.executionEnvironment).toMatchObject({ type: 'ssh', runtimeCwd: checkout });
      const response = await fetch(origin(session) + '/inspect', {
        headers: { Cookie: cookie(session) + '; automaker_session=SECRET', 'X-API-Key': 'SECRET' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ source: 'TARGET_SOURCE', cwd: checkout });
      expect(response.headers.get('set-cookie')).toBeNull();
      const ws = new WebSocket(origin(session).replace('http:', 'ws:') + '/hmr', {
        headers: { Cookie: cookie(session), Origin: origin(session) },
      });
      await once(ws, 'open');
      const echoed = once(ws, 'message');
      ws.send(Buffer.from([0, 255, 128]));
      expect(Buffer.from((await echoed)[0])).toEqual(Buffer.from([0, 255, 128]));
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      expect((await post('stop-dev', { worktreePath: project })).code).toBe(
        'DEV_SESSION_ID_REQUIRED'
      );
      expect(
        (await post('stop-dev', { worktreePath: project, sessionId: session.sessionId })).success
      ).toBe(true);
      await vi.waitFor(() => expect(ws.readyState).toBe(WebSocket.CLOSED));
      expect((await post('list-dev-servers', {})).result.servers).toHaveLength(0);
      expect(await fs.readFile(path.join(checkout, 'effects'), 'utf8')).toBe('once\n');
      await expect(fs.stat(path.join(project, 'effects'))).rejects.toThrow();
    }
  );
  it(
    'uses a retired feature pin rather than its controller alias/new Local default',
    { timeout: 30000 },
    async () => {
      const run = (await new FeatureWorkspaceService(settings).prepare(
        project,
        { id: 'feature', model: 'cursor-auto', branchName: 'main' },
        active()
      ))!;
      const alias = workspaceAlias(run.binding)!;
      await settings.updateGlobalSettings({
        executionEnvironment: { default: { mode: 'local' }, profiles: [] },
      });
      const session = await ready((await start('node dev.cjs', alias)).sessionId);
      const response = await fetch(origin(session), { headers: { Cookie: cookie(session) } });
      expect((await response.json()).cwd).toBe(run.environment.cwd);
      await expect(fs.stat(alias)).rejects.toThrow();
    }
  );
  it(
    'does not attach to or kill an unrelated listener when the command ignores PORT',
    { timeout: 30000 },
    async () => {
      let requests = 0;
      const unrelated = createServer((_req, res) => {
        requests++;
        res.end('UNRELATED_SECRET');
      });
      let blockedPort = 0;
      for (let port = 4100; port <= 4119; port++) {
        try {
          unrelated.listen(port, '127.0.0.1');
          await once(unrelated, 'listening');
          blockedPort = port;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        }
      }
      expect(blockedPort).toBeGreaterThan(0);
      try {
        const session = await start(
          `node -e "require('node:http').createServer((q,s)=>s.end('wrong')).listen(${blockedPort},'127.0.0.1')"`
        );
        await vi.waitFor(
          () => expect(service.find(undefined, session.sessionId)?.finished).toBe(true),
          { timeout: 10000 }
        );
        expect(service.find(undefined, session.sessionId)?.ready).toBe(false);
        expect(unrelated.listening).toBe(true);
        expect(requests).toBe(0);
      } finally {
        unrelated.closeAllConnections();
        await new Promise<void>((resolve) => unrelated.close(() => resolve()));
      }
    }
  );
  it(
    'revokes preview and records unknown cleanup after SSH transport loss without replay',
    { timeout: 30000 },
    async () => {
      const session = await ready((await start()).sessionId);
      peer.disconnect();
      await vi.waitFor(() =>
        expect(service.find(undefined, session.sessionId)?.finished).toBe(true)
      );
      await expect(service.stop(session.sessionId)).rejects.toMatchObject({
        code: 'DEV_CLEANUP_UNVERIFIED',
      });
      expect(await fs.readFile(path.join(checkout, 'effects'), 'utf8')).toBe('once\n');
      expect(service.list()).toHaveLength(0);
    }
  );
  it.skipIf(!process.env.DIRECT_PROVIDER_BROWSER_EXECUTABLE)(
    'loads real Vite modules/HMR in Chromium and blocks preview access to controller API/WS/cookies',
    { timeout: 45000 },
    async () => {
      await fs.mkdir(path.join(checkout, 'node_modules', '.bin'), { recursive: true });
      await fs.symlink(
        path.resolve('node_modules/vite/bin/vite.js'),
        path.join(checkout, 'node_modules', '.bin', 'vite')
      );
      await fs.writeFile(
        path.join(checkout, 'package.json'),
        JSON.stringify({ scripts: { dev: 'vite' }, type: 'module' })
      );
      await fs.writeFile(
        path.join(checkout, 'vite.config.mjs'),
        "export default {cacheDir:'.vite-cache'}"
      );
      await fs.writeFile(
        path.join(checkout, 'index.html'),
        '<html><body><script type="module" src="/main.js"></script></body></html>'
      );
      const source = (version: string) =>
        `document.body.innerHTML='<h1>${version}</h1>'; if(import.meta.hot) import.meta.hot.accept();`;
      await fs.writeFile(path.join(checkout, 'main.js'), source('VERSION_ONE'));
      let protectedRequests = 0,
        protectedSockets = 0;
      const controller = express();
      controller.get('/', (_req, res) => {
        res.cookie('automaker_session', 'CONTROLLER_HTTP_ONLY', {
          httpOnly: true,
          sameSite: 'lax',
        });
        res.send('Controller');
      });
      controller.use('/api', native.policy.apiGuard, (_req, res) => {
        protectedRequests++;
        res.send('CONTROLLER_SECRET');
      });
      const main = createServer(controller);
      main.on('upgrade', (req, socket) => {
        if (!native.policy.isApiRequest(req)) protectedSockets++;
        socket.destroy();
      });
      main.listen(0, '127.0.0.1');
      await once(main, 'listening');
      const controllerUrl = `http://127.0.0.1:${(main.address() as { port: number }).port}`;
      const browser = await chromium.launch({
        executablePath: process.env.DIRECT_PROVIDER_BROWSER_EXECUTABLE,
        headless: true,
        args: ['--no-sandbox'],
      });
      try {
        const session = await ready((await start('')).sessionId);
        const page = await browser.newPage();
        const sockets: string[] = [];
        let hmrConnected = false;
        const browserMessages: string[] = [];
        page.on('console', (message) =>
          browserMessages.push(message.text().replace(/#[a-f0-9]{64}/g, '#[redacted]'))
        );
        page.on('pageerror', (error) => browserMessages.push(error.message));
        page.on('websocket', (ws) => {
          sockets.push(ws.url());
          ws.on('framereceived', ({ payload }) => {
            if (String(payload).includes('"type":"connected"')) hmrConnected = true;
          });
        });
        await page.goto(controllerUrl);
        await page.goto(session.url.replace('localhost', '127.0.0.1'));
        await page.getByRole('heading', { name: 'VERSION_ONE' }).waitFor();
        await vi.waitFor(() => expect(hmrConnected).toBe(true), { timeout: 10000 });
        await fs.writeFile(path.join(checkout, 'main.js'), source('VERSION_TWO'));
        try {
          await page.getByRole('heading', { name: 'VERSION_TWO' }).waitFor({ timeout: 10000 });
        } catch {
          throw new Error(
            JSON.stringify({
              sockets,
              browserMessages,
              targetLog: service.find(undefined, session.sessionId)?.logs,
            })
          );
        }
        expect(sockets.some((url) => new URL(url).port === String(session.port))).toBe(true);
        expect(sockets.every((url) => new URL(url).port !== String(session.targetPort))).toBe(true);
        await page.evaluate(async (url) => {
          await fetch(url + '/api/protected', { credentials: 'include' }).catch(() => {});
          await new Promise<void>((resolve) => {
            const ws = new globalThis.WebSocket(url.replace('http:', 'ws:') + '/api/events');
            ws.onerror = () => resolve();
            ws.onclose = () => resolve();
          }).catch(() => {});
          globalThis.document.cookie = 'automaker_session=POISON; Path=/';
        }, controllerUrl);
        expect(protectedRequests).toBe(0);
        expect(protectedSockets).toBe(0);
        expect(
          (await page.context().cookies(controllerUrl)).find((c) => c.name === 'automaker_session')
            ?.value
        ).toBe('CONTROLLER_HTTP_ONLY');
        await expect(
          page.evaluate(() => globalThis.navigator.serviceWorker.register('/worker.js'))
        ).rejects.toThrow();
      } finally {
        await browser.close();
        main.closeAllConnections();
        await new Promise<void>((resolve) => main.close(() => resolve()));
      }
    }
  );
});
