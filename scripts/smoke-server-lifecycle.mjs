#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertProductionServerArtifact } from '../apps/server/scripts/check-build.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
await assertProductionServerArtifact(path.join(repositoryRoot, 'apps/server/dist'));

async function smoke(signal) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'automaker-lifecycle-smoke-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve()))
  );

  const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
    cwd: repositoryRoot,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: path.join(temporary, 'home'),
      USERPROFILE: path.join(temporary, 'home'),
      XDG_CONFIG_HOME: path.join(temporary, 'config'),
      APPDATA: path.join(temporary, 'config'),
      XDG_CACHE_HOME: path.join(temporary, 'cache'),
      ENABLE_REQUEST_LOGGING: 'false',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: temporary,
      ALLOWED_ROOT_DIRECTORY: temporary,
      AUTOMAKER_API_KEY: 'automaker-lifecycle-smoke-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.resume();
  child.stderr.resume();
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  const exited = once(child, 'exit');
  exited.catch(() => {});
  try {
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, 'Server exited before becoming ready');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok && (await response.json()).status === 'ready';
      } catch {
        /* Startup has not finished listening yet. */
      }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Server did not become ready before the startup deadline');
    const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/settings/status`);
    assert.equal(protectedResponse.status, 401);
    await protectedResponse.arrayBuffer();

    const stoppedAt = performance.now();
    child.kill(signal);
    let timer;
    let result;
    try {
      result = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Shutdown exceeded 5 seconds')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(result[0], 0, `Server did not exit cleanly after ${signal}`);
    console.log(
      JSON.stringify({ signal, exitCode: result[0], shutdownMs: performance.now() - stoppedAt })
    );
  } catch (error) {
    throw new Error(`${signal} lifecycle smoke failed: ${error.message}`);
  } finally {
    if (!spawnError && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) await smoke(signal);
