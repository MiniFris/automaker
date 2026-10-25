import assert from 'node:assert/strict';
import { access, cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright';

const sourceExecutable = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '../release/linux-unpacked/automaker')
);
await access(sourceExecutable);
await assert.rejects(access(path.join(path.dirname(sourceExecutable), 'resources', '.env')), {
  code: 'ENOENT',
});
const profile = await mkdtemp(path.join(os.tmpdir(), 'automaker-packaged-smoke-'));
// Run outside the workspace so missing production dependencies cannot fall back
// to the monorepo's development node_modules through parent-directory resolution.
const artifact = path.join(profile, 'application');
await cp(path.dirname(sourceExecutable), artifact, { recursive: true });
const executablePath = path.join(artifact, path.basename(sourceExecutable));
const runtime = path.join(profile, 'runtime');
await mkdir(runtime, { mode: 0o700 });
let application;
let backendUrl;
let confirmedClosed = false;
try {
  // Do not expose the operator's home, provider credentials or API keys to acceptance.
  application = await _electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu'],
    timeout: 30_000,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: profile,
      XDG_CONFIG_HOME: path.join(profile, 'config'),
      XDG_CACHE_HOME: path.join(profile, 'cache'),
      XDG_DATA_HOME: path.join(profile, 'data'),
      XDG_RUNTIME_DIR: runtime,
      DISPLAY: process.env.DISPLAY ?? '',
      XAUTHORITY: process.env.XAUTHORITY ?? '',
      NODE_ENV: 'production',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  const identity = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    data: app.getPath('userData'),
  }));
  assert.equal(identity.packaged, true);
  const relative = path.relative(profile, identity.data);
  assert.ok(
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
  const window = await application.firstWindow();
  const pageErrors = [];
  window.on('pageerror', (error) => pageErrors.push(error.message));
  await window.waitForLoadState('domcontentloaded');
  backendUrl = await window.evaluate(() => window.electronAPI.getServerUrl());
  assert.match(backendUrl, /^http:\/\/localhost:\d+$/);
  await window.waitForFunction(() => {
    const application = globalThis.document.getElementById('app');
    return (
      application && application.childElementCount > 0 && !application.querySelector('.app-shell')
    );
  });
  assert.deepEqual(pageErrors, []);
  const ready = await globalThis.fetch(`${backendUrl}/api/health/ready`, {
    signal: globalThis.AbortSignal.timeout(5000),
  });
  assert.equal(ready.status, 200);
  const protectedResponse = await globalThis.fetch(`${backendUrl}/api/health/detailed`, {
    signal: globalThis.AbortSignal.timeout(5000),
  });
  assert.equal(protectedResponse.status, 401);
  const native = await application.evaluate(async ({ app }) => {
    const require = process
      .getBuiltinModule('node:module')
      .createRequire(`${process.resourcesPath}/server/package.json`);
    const pty = require('node-pty');
    return await new Promise((resolve, reject) => {
      let output = '';
      const child = pty.spawn(process.execPath, ['--version'], {
        cwd: app.getPath('userData'),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        name: 'xterm',
        cols: 80,
        rows: 24,
      });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Packaged PTY did not finish.'));
      }, 5000);
      child.onData((chunk) => {
        output += chunk;
      });
      child.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        resolve({ exitCode, version: output.trim() });
      });
    });
  });
  assert.equal(native.exitCode, 0);
  assert.match(native.version, /^v\d+\./);
  await application.close();
  application = undefined;
  await assert.rejects(
    globalThis.fetch(`${backendUrl}/api/health`, { signal: globalThis.AbortSignal.timeout(1000) })
  );
  confirmedClosed = true;
  console.log(
    JSON.stringify({
      packaged: true,
      rendererMounted: true,
      readiness: 200,
      protected: 401,
      nativePty: native,
      backendClosed: true,
    })
  );
} finally {
  if (application) await application.close();
  if (confirmedClosed) await rm(profile, { recursive: true, force: true });
  else console.error('Packaged smoke profile retained for cleanup inspection:', profile);
}
