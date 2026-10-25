#!/usr/bin/env node
// Linux acceptance for an existing unpacked artifact. Never builds or invokes providers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertProductionServerArtifact } from '../apps/server/scripts/check-build.mjs';

const usage =
  'Usage: node scripts/smoke-packaged-electron.mjs --executable /absolute/path/linux-unpacked/automaker\nRun under an existing X11 display (for example xvfb-run -a). No build is performed.';
const { values } = parseArgs({
  options: { executable: { type: 'string' }, help: { type: 'boolean' } },
});

function bounded(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function until(predicate, milliseconds, label) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`${label} timed out`);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(true)); // A timeout cannot confirm closure.
  });
}

async function processIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // comm may contain spaces/parentheses; fields after its final ')' start at field 3.
    return { pid, start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}
async function sameProcess(identity) {
  return identity && (await processIdentity(identity.pid))?.start === identity.start;
}

async function signalOwned(identity, signal) {
  if (!(await sameProcess(identity))) return;
  try {
    process.kill(identity.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function ownBackend(electronPid, serverMain, dataDir, apiKey) {
  const children = (await readFile(`/proc/${electronPid}/task/${electronPid}/children`, 'utf8'))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const value of children) {
    const pid = Number(value);
    try {
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      if (!argv.includes(serverMain)) continue;
      const environment = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0');
      assert.ok(
        environment.includes(`DATA_DIR=${dataDir}`),
        'Backend DATA_DIR is not the private profile'
      );
      assert.ok(
        environment.includes(`AUTOMAKER_API_KEY=${apiKey}`),
        'Backend does not own the fixture API key'
      );
      return await processIdentity(pid);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
    }
  }
  return null;
}

async function jsonRequest(base, route, { key, method = 'GET', body } = {}) {
  const response = await fetch(new URL(route, base), {
    method,
    headers: {
      ...(key && { 'x-api-key': key }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/json\b/i,
    `${route} returned non-JSON`
  );
  return { status: response.status, body: await response.json() };
}

async function terminalCommand(WebSocket, base, key, workspace) {
  const created = await jsonRequest(base, '/api/terminal/sessions', {
    key,
    method: 'POST',
    body: { cwd: workspace, shell: '/bin/sh', cols: 80, rows: 24 },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.success, true);
  const id = created.body.data?.id;
  assert.equal(typeof id, 'string');
  const endpoint = new URL('/api/terminal/ws', base);
  endpoint.protocol = 'ws:';
  endpoint.searchParams.set('apiKey', key);
  endpoint.searchParams.set('sessionId', id);
  const socket = new WebSocket(endpoint);
  let output = '';
  let sent = false;
  let exitCode;
  const marker = `SMOKE_${randomUUID().replaceAll('-', '')}`;
  try {
    await bounded(
      new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.once('close', () => {
          if (exitCode === undefined) reject(new Error('Terminal closed before reporting exit'));
        });
        socket.on('message', (raw) => {
          try {
            const message = JSON.parse(raw.toString());
            if (message.type === 'connected' && !sent) {
              assert.equal(message.sessionId, id);
              sent = true;
              // No literal marker in the input: shell echo cannot satisfy the output assertion.
              const midpoint = Math.floor(marker.length / 2);
              socket.send(
                JSON.stringify({
                  type: 'input',
                  data: `printf '\\n%s%s\\n' '${marker.slice(0, midpoint)}' '${marker.slice(midpoint)}'; exit 0\n`,
                })
              );
            }
            if (message.type === 'data' || message.type === 'scrollback') {
              output += message.data;
              if (output.length > 128 * 1024)
                reject(new Error('Terminal output exceeded the smoke bound'));
            }
            if (message.type === 'error') reject(new Error('Terminal protocol reported an error'));
            if (message.type === 'exit') {
              exitCode = message.exitCode;
              resolve();
            }
          } catch (error) {
            reject(error);
          }
        });
      }),
      15000,
      'PTY command'
    );
    assert.equal(exitCode, 0);
    assert.ok(
      output.replaceAll('\r', '').split('\n').includes(marker),
      'PTY did not produce the exact command output'
    );
    await until(
      async () => {
        const sessions = await jsonRequest(base, '/api/terminal/sessions', { key });
        assert.equal(sessions.status, 200);
        assert.ok(Array.isArray(sessions.body.data));
        return !sessions.body.data.some((session) => session.id === id);
      },
      5000,
      'PTY session cleanup'
    );
    return { ptyExitCode: exitCode, terminalCleaned: true };
  } finally {
    socket.terminate();
    // Only the session created above is eligible for fallback deletion.
    await jsonRequest(base, `/api/terminal/sessions/${encodeURIComponent(id)}`, {
      key,
      method: 'DELETE',
    }).catch(() => {});
  }
}

async function main() {
  assert.equal(
    process.platform,
    'linux',
    'This acceptance script targets Linux unpacked artifacts'
  );
  assert.ok(values.executable, usage);
  const executable = await realpath(path.resolve(values.executable));
  await access(executable);
  const resources = path.join(path.dirname(executable), 'resources');
  const serverRoot = path.join(resources, 'server');
  await assertProductionServerArtifact(serverRoot);
  const repository = path.resolve(import.meta.dirname, '..');
  const uiRequire = createRequire(path.join(repository, 'apps/ui/package.json'));
  const serverRequire = createRequire(path.join(repository, 'apps/server/package.json'));
  const { _electron } = uiRequire('playwright');
  const { default: WebSocket } = await import(pathToFileURL(serverRequire.resolve('ws')).href);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'automaker-packaged-smoke-'));
  const home = path.join(temporary, 'home');
  const config = path.join(temporary, 'config');
  const userData = path.join(config, 'Automaker');
  const workspace = path.join(temporary, 'workspace');
  const cwd = path.join(temporary, 'launch');
  for (const directory of [
    home,
    userData,
    workspace,
    cwd,
    path.join(temporary, 'cache'),
    path.join(temporary, 'runtime'),
  ])
    await mkdir(directory, { recursive: true, mode: 0o700 });
  const apiKey = randomUUID();
  await writeFile(path.join(userData, '.api-key'), apiKey, { mode: 0o600 });
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: config,
    APPDATA: config,
    LOCALAPPDATA: config,
    XDG_CACHE_HOME: path.join(temporary, 'cache'),
    XDG_RUNTIME_DIR: path.join(temporary, 'runtime'),
    NODE_ENV: 'production',
    DATA_DIR: userData,
    ALLOWED_ROOT_DIRECTORY: temporary,
    AUTOMAKER_API_KEY: apiKey,
    ENABLE_REQUEST_LOGGING: 'false',
    ...(process.env.DISPLAY && { DISPLAY: process.env.DISPLAY }),
    ...(process.env.XAUTHORITY && { XAUTHORITY: process.env.XAUTHORITY }),
  };
  let application;
  let backend;
  let base;
  let passed = false;
  let closed = false;
  let result;
  let logs = '';
  const appendLog = (chunk) => {
    logs = (logs + chunk.toString().replaceAll(apiKey, '[fixture-key]')).slice(-1024 * 1024);
  };
  try {
    application = await _electron.launch({
      executablePath: executable,
      cwd,
      env,
      args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`],
      timeout: 45000,
    });
    application.process().stdout?.on('data', appendLog);
    application.process().stderr?.on('data', appendLog);
    const facts = await bounded(
      application.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        userData: app.getPath('userData'),
        resources: process.resourcesPath,
      })),
      10000,
      'Packaged identity'
    );
    assert.equal(facts.packaged, true);
    assert.equal(path.resolve(facts.userData), userData);
    assert.equal(path.resolve(facts.resources), resources);
    await until(
      async () => {
        backend = await ownBackend(
          application.process().pid,
          path.join(serverRoot, 'main.js'),
          userData,
          apiKey
        );
        return Boolean(backend);
      },
      30000,
      'Owned embedded backend startup'
    );
    const page = await application.firstWindow({ timeout: 45000 });
    await page.waitForFunction(
      () => Boolean(globalThis.document.getElementById('app')?.childElementCount),
      undefined,
      { timeout: 30000 }
    );
    const connection = await bounded(
      page.evaluate(async () => ({
        base: await globalThis.electronAPI.getServerUrl(),
        key: await globalThis.electronAPI.getApiKey(),
        packaged: await globalThis.electronAPI.isPackaged(),
        external: await globalThis.electronAPI.isExternalServerMode(),
      })),
      10000,
      'Preload bridge'
    );
    assert.ok(connection.key === apiKey, 'Preload does not own the fixture API key');
    assert.equal(connection.packaged, true);
    assert.equal(connection.external, false);
    base = new URL(connection.base);
    assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
    assert.equal(base.protocol, 'http:');
    assert.ok(Number(base.port) > 0);
    const ready = await jsonRequest(base, '/api/health/ready');
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, 'ready');
    const denied = await jsonRequest(base, '/api/health/detailed');
    assert.equal(denied.status, 401);
    const health = await jsonRequest(base, '/api/health/detailed', { key: apiKey });
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');
    assert.equal(path.resolve(health.body.dataDir), userData);
    const terminal = await terminalCommand(WebSocket, base, apiKey, workspace);
    result = {
      packaged: true,
      rendererMounted: true,
      readyStatus: ready.status,
      unauthenticatedStatus: denied.status,
      authenticatedStatus: health.status,
      compiledServerWithoutLegacy: true,
      ...terminal,
    };
    passed = true;
  } finally {
    // Close this launch only. Never use process-name matching or kill a port's occupant.
    if (application) {
      const child = application.process();
      try {
        await bounded(application.close(), 15000, 'Electron shutdown');
      } catch (error) {
        passed = false;
        appendLog(`\n${error.message}\n`);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await until(
          async () => child.exitCode !== null || child.signalCode !== null,
          5000,
          'Owned Electron termination'
        ).catch(() => {
          child.kill('SIGKILL');
        });
      }
      // A backend which outlives its owner is a failed acceptance, even if fallback succeeds.
      try {
        await until(async () => !(await sameProcess(backend)), 10000, 'Backend shutdown');
        if (base)
          await until(
            async () => !(await portOpen(Number(base.port))),
            5000,
            'Backend port closure'
          );
        closed = child.exitCode !== null || child.signalCode !== null;
      } catch (error) {
        passed = false;
        appendLog(`\n${error.message}\n`);
        if (await sameProcess(backend)) {
          await signalOwned(backend, 'SIGTERM');
          await until(
            async () => !(await sameProcess(backend)),
            5000,
            'Owned backend termination'
          ).catch(async () => {
            await signalOwned(backend, 'SIGKILL');
          });
        }
      }
    }
    if (passed && closed) await rm(temporary, { recursive: true, force: true });
    else {
      await writeFile(path.join(temporary, 'smoke.log'), logs, { mode: 0o600 });
      console.error(`Packaged smoke diagnostics retained: ${temporary}`);
    }
  }
  assert.ok(passed && closed, 'Packaged smoke cleanup was not confirmed');
  console.log(JSON.stringify({ ...result, backendClosed: true, profileRemoved: true }));
}

if (values.help) console.log(usage);
else await main();
