#!/usr/bin/env node

// Bounded offline Linux acceptance, not a throughput benchmark or production SLO.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertProductionServerArtifact } from '../apps/server/scripts/check-build.mjs';

assert.equal(process.platform, 'linux', 'Linux /proc acceptance only');
const root = path.resolve(import.meta.dirname, '..');
await assertProductionServerArtifact(path.join(root, 'apps/server/dist'));
const WebSocket = createRequire(new URL('../apps/server/package.json', import.meta.url))('ws');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'automaker-workload-'));
const project = path.join(temporary, 'project');
await mkdir(project);
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve()))
);
const key = randomUUID();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
  cwd: root,
  env: {
    PATH: '/usr/bin:/bin',
    HOME: path.join(temporary, 'home'),
    USERPROFILE: path.join(temporary, 'home'),
    XDG_CONFIG_HOME: path.join(temporary, 'config'),
    APPDATA: path.join(temporary, 'config'),
    XDG_CACHE_HOME: path.join(temporary, 'cache'),
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: path.join(temporary, 'data'),
    ALLOWED_ROOT_DIRECTORY: temporary,
    AUTOMAKER_API_KEY: key,
    ENABLE_REQUEST_LOGGING: 'false',
    SHELL: '/bin/sh',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-16000);
  });
const exited = once(child, 'exit');
exited.catch(() => {});
const sockets = new Set();
const observedChildren = new Map();
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(check, milliseconds, label) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`${label} did not settle`);
}
async function request(route, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + '/api/' + route, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`);
  assert.notEqual(result.success, false, `${route} failed`);
  return result;
}
async function descendants(pid) {
  const direct = (
    await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    })
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  const result = [...direct];
  for (const id of direct) {
    const stat = await readFile(`/proc/${id}/stat`, 'utf8').catch(() => '');
    observedChildren.set(id, stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    result.push(...(await descendants(id)));
  }
  return result;
}
async function sample() {
  return {
    fd: (await readdir(`/proc/${child.pid}/fd`)).length,
    children: (await descendants(child.pid)).length,
  };
}
async function socket(route) {
  const endpoint = new URL(route, base);
  endpoint.protocol = 'ws:';
  endpoint.searchParams.set('apiKey', key);
  const ws = new WebSocket(endpoint);
  sockets.add(ws);
  await bounded(once(ws, 'open'), 5000, 'WebSocket open');
  return ws;
}
async function closeSocket(ws) {
  const closed = once(ws, 'close');
  ws.close();
  await bounded(closed, 5000, 'WebSocket close');
  sockets.delete(ws);
}
async function terminalCycle() {
  const session = (
    await request('terminal/sessions', { cwd: project, shell: '/bin/sh', cols: 80, rows: 24 })
  ).data;
  await descendants(child.pid);
  const endpoint = new URL('/api/terminal/ws', base);
  endpoint.protocol = 'ws:';
  endpoint.searchParams.set('apiKey', key);
  endpoint.searchParams.set('sessionId', session.id);
  const ws = new WebSocket(endpoint);
  sockets.add(ws);
  let output = '';
  const marker = `WORKLOAD_${randomUUID().replaceAll('-', '')}`;
  try {
    await bounded(
      new Promise((resolve, reject) => {
        ws.once('error', reject);
        ws.once('close', () => reject(new Error('PTY closed before exit')));
        ws.on('message', (raw) => {
          try {
            const message = JSON.parse(raw.toString());
            if (message.type === 'connected') {
              ws.send(
                JSON.stringify({
                  type: 'input',
                  data: `printf '\\n%s%s\\n' '${marker.slice(0, 12)}' '${marker.slice(12)}'; exit 0\n`,
                })
              );
            }
            if (message.type === 'data' || message.type === 'scrollback') {
              output += message.data;
              assert.ok(output.length < 128 * 1024);
            }
            if (message.type === 'error') reject(new Error('PTY protocol error'));
            if (message.type === 'exit') {
              assert.equal(message.exitCode, 0);
              resolve();
            }
          } catch (error) {
            reject(error);
          }
        });
      }),
      10000,
      'PTY command'
    );
    assert.ok(
      output.replaceAll('\r', '').split('\n').includes(marker),
      `Actual shell output missing: ${JSON.stringify(output)}`
    );
    await until(
      async () => !(await request('terminal/sessions')).data.some((item) => item.id === session.id),
      5000,
      'PTY cleanup'
    );
    await descendants(child.pid);
  } finally {
    ws.terminate();
    sockets.delete(ws);
    await request(`terminal/sessions/${encodeURIComponent(session.id)}`, undefined, 'DELETE').catch(
      () => {}
    );
  }
}
try {
  await until(
    async () => {
      assert.equal(child.exitCode, null, 'Server exited during startup');
      try {
        return (await fetch(base + '/api/health/ready', { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    30000,
    'Startup'
  );
  // Warm HTTP pools, terminal module and shell cleanup before establishing the baseline.
  await request('features/list', { projectPath: project });
  await terminalCycle();
  await delay(500);
  const baseline = await sample();
  assert.equal(baseline.children, 0, 'Warm-up retained a child');
  const samples = [];
  const started = performance.now();
  let eventCount = 0;
  for (let wave = 0; wave < 5; wave++) {
    const ws = await socket('/api/events');
    const ids = new Set();
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'feature:created' && message.payload?.projectPath === project) {
        ids.add(message.payload.featureId);
        eventCount++;
      }
    });
    for (let index = 0; index < 20; index++) {
      const featureId = `workload-${wave}-${index}`;
      const created = await request('features/create', {
        projectPath: project,
        feature: {
          id: featureId,
          title: featureId,
          description: 'Offline workload',
          status: 'backlog',
        },
      });
      assert.equal(created.feature.id, featureId);
      const updated = await request('features/update', {
        projectPath: project,
        featureId,
        updates: { description: 'Updated offline workload' },
      });
      assert.equal(updated.feature.description, 'Updated offline workload');
      const fetched = await request('features/get', { projectPath: project, featureId });
      assert.equal(fetched.feature.description, 'Updated offline workload');
    }
    assert.equal(
      (await request('features/list', { projectPath: project })).features.length,
      (wave + 1) * 20
    );
    await until(() => ids.size === 20, 5000, 'Feature event delivery');
    await closeSocket(ws);
    await terminalCycle();
    await terminalCycle();
    await delay(150);
    const current = await sample();
    samples.push(current);
    assert.equal(current.children, baseline.children, 'Settled wave retained children');
    assert.ok(
      current.fd <= baseline.fd + 8,
      `FD budget exceeded: ${JSON.stringify({ baseline, current })}`
    );
  }
  for (let wave = 0; wave < 5; wave++)
    for (let index = 0; index < 20; index++)
      await request('features/delete', {
        projectPath: project,
        featureId: `workload-${wave}-${index}`,
      });
  assert.equal((await request('features/list', { projectPath: project })).features.length, 0);
  assert.equal((await request('terminal/sessions')).data.length, 0);
  assert.equal((await request('metrics')).providerActiveQueries, 0);
  await delay(300);
  const final = await sample();
  assert.equal(final.children, 0);
  assert.ok(final.fd <= baseline.fd + 8);
  const workloadMs = performance.now() - started;
  const stop = performance.now();
  child.kill('SIGTERM');
  const [exitCode] = await bounded(exited, 5000, 'Shutdown');
  assert.equal(exitCode, 0);
  const survivors = [];
  for (const [pid, started] of observedChildren) {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (stat && stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === started)
      survivors.push(pid);
  }
  assert.deepEqual(survivors, [], 'Observed owned descendants survived shutdown');
  console.log(
    JSON.stringify({
      features: 100,
      featureMutations: 300,
      featureGets: 100,
      featureLists: 7,
      eventConnections: 5,
      deliveredEvents: eventCount,
      terminalCycles: 11,
      baseline,
      samples,
      final,
      workloadMs,
      shutdownMs: performance.now() - stop,
      exitCode,
      observedChildPids: observedChildren.size,
      fdGrowthBudget: 8,
    })
  );
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  for (const ws of sockets) ws.terminate();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
