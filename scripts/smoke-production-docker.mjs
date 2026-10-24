#!/usr/bin/env node

// Usage: node scripts/smoke-production-docker.mjs --image <already-built-image>
// Offline acceptance: no image build/pull, host mounts, provider/model calls or operator data.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/smoke-production-docker.mjs --image <already-built-image>');
  process.exit(0);
}
assert.ok(
  args.length === 2 && args[0] === '--image' && args[1] && !args[1].startsWith('-'),
  'Required: --image <already-built-image>. No default image is selected.'
);
const image = args[1];
const { unzipSync, strFromU8 } = createRequire(
  new URL('../apps/server/package.json', import.meta.url)
)('fflate');
const exec = promisify(execFile);
async function docker(...arguments_) {
  return (
    await exec('docker', arguments_, { encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024 })
  ).stdout.trim();
}
const token = randomUUID();
const name = `automaker-production-smoke-${token}`;
const label = 'automaker.acceptance.owner';
const apiKey = randomUUID();
const data = `/tmp/automaker-smoke-${token}`;
const project = `${data}/project`;
let creationAttempted = false;
let failure;
let stage = 'inspect image';
let result;
async function ownedContainer() {
  try {
    const [container] = JSON.parse(await docker('inspect', name));
    return container.Config?.Labels?.[label] === token ? container : null;
  } catch {
    return null;
  }
}
try {
  // Pin the inspected local artifact. --pull=never prevents implicit network activity.
  const imageId = await docker('image', 'inspect', '--format', '{{.Id}}', image);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  stage = 'create owned container';
  creationAttempted = true;
  await docker(
    'create',
    '--pull=never',
    '--name',
    name,
    '--label',
    `${label}=${token}`,
    '--publish',
    '127.0.0.1::3008',
    '--env',
    'NODE_ENV=production',
    '--env',
    'HOST=0.0.0.0',
    '--env',
    'PORT=3008',
    '--env',
    `AUTOMAKER_API_KEY=${apiKey}`,
    '--env',
    'ENABLE_REQUEST_LOGGING=false',
    '--env',
    `DATA_DIR=${data}`,
    '--env',
    `ALLOWED_ROOT_DIRECTORY=${data}`,
    '--env',
    `HOME=${data}/home`,
    '--env',
    `XDG_CONFIG_HOME=${data}/config`,
    '--env',
    `XDG_CACHE_HOME=${data}/cache`,
    imageId
  );
  await docker('start', name);
  const container = await ownedContainer();
  assert.ok(container, 'Created container ownership cannot be verified');
  assert.equal(container.Image, imageId);
  assert.equal(container.Mounts.length, 0, 'Smoke container must not use host/operator volumes');
  const bindings = container.NetworkSettings.Ports['3008/tcp'];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, '127.0.0.1');
  const url = `http://127.0.0.1:${bindings[0].HostPort}`;
  async function request(route, body, authenticated = true) {
    const response = await fetch(`${url}/api/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(authenticated ? { 'x-api-key': apiKey } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    return response;
  }
  async function json(route, body, status = 200) {
    const response = await request(route, body);
    assert.equal(response.status, status, `${route}: unexpected HTTP status`);
    return response.json();
  }
  stage = 'readiness';
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await request('health/ready', undefined, false);
      ready = response.status === 200 && (await response.json()).status === 'ready';
    } catch {
      /* Listener may not be ready yet. */
    }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, 'Production container did not become ready within 30 seconds');
  stage = 'authentication';
  const unauthorized = await request('health/detailed', undefined, false);
  assert.equal(unauthorized.status, 401);
  await unauthorized.arrayBuffer();
  assert.equal((await json('health/detailed')).status, 'ok');
  stage = 'owned fixture';
  await docker(
    'exec',
    '--user',
    'automaker',
    name,
    'node',
    '-e',
    "const fs=require('node:fs');fs.mkdirSync(process.argv[1],{recursive:true});fs.writeFileSync(process.argv[1]+'/fixture.txt','isolated-archive-fixture')",
    project
  );
  stage = 'scoped feature CRUD';
  const featureId = `smoke-${token}`;
  const feature = {
    id: featureId,
    title: 'Production smoke fixture',
    description: 'Offline acceptance fixture',
    status: 'backlog',
  };
  const created = await json('features/create', { projectPath: project, feature });
  assert.equal(created.success, true);
  assert.equal(created.feature.title, feature.title);
  assert.equal(created.feature.id, featureId);
  const updated = await json('features/update', {
    projectPath: project,
    featureId,
    updates: { description: 'Updated offline fixture' },
  });
  assert.equal(updated.feature.description, 'Updated offline fixture');
  const fetched = await json('features/get', { projectPath: project, featureId });
  assert.equal(fetched.feature.description, 'Updated offline fixture');
  const denied = await json(
    'features/create',
    { projectPath: '/tmp/outside-smoke-root', feature },
    403
  );
  assert.equal(denied.success, false);
  assert.equal((await json('features/delete', { projectPath: project, featureId })).success, true);
  await json('features/get', { projectPath: project, featureId }, 404);
  stage = 'native archive';
  const archive = await request('fs/download', { filePath: project });
  assert.equal(archive.status, 200);
  const content = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(strFromU8(content['project/fixture.txt']), 'isolated-archive-fixture');
  stage = 'metrics JSON';
  const metrics = await json('metrics');
  assert.equal(metrics.schemaVersion, 1);
  assert.equal(metrics.providerActiveQueries, 0);
  assert.ok(Number.isFinite(metrics.uptimeMs) && metrics.uptimeMs >= 0);
  assert.ok(Array.isArray(metrics.counters) && Array.isArray(metrics.observations));
  stage = 'production artifact';
  const runtime = JSON.parse(
    await docker(
      'exec',
      name,
      'node',
      '-e',
      `
    const fs=require('node:fs');
    const resolve=require('node:module').createRequire('/app/apps/server/package.json').resolve;
    const toolchain=['typescript','vitest','tsx'];
    const developmentToolchainAbsent=toolchain.every(name=>{try{resolve(name);return false}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;return true}});
    const reserved=['routes','legacy','legacy-application.js'];
    console.log(JSON.stringify({node:process.version,developmentToolchainAbsent,
      legacyAbsent:reserved.every(name=>!fs.existsSync('/app/apps/server/dist/'+name))}));
  `
    )
  );
  assert.equal(runtime.developmentToolchainAbsent, true);
  assert.equal(runtime.legacyAbsent, true);
  stage = 'SIGTERM shutdown';
  await docker('stop', '--time', '30', name);
  const stopped = await ownedContainer();
  assert.ok(stopped);
  assert.equal(stopped.State.Running, false);
  assert.equal(stopped.State.ExitCode, 0);
  assert.equal(stopped.State.OOMKilled, false);
  result = {
    image,
    imageId,
    readiness: 200,
    protected: 401,
    scopedFeatureCrud: true,
    nativeArchive: true,
    metricsJson: true,
    ...runtime,
    sigtermExitCode: stopped.State.ExitCode,
  };
} catch (error) {
  failure = new Error(
    `Production Docker smoke failed at ${stage}: ${error.message.replaceAll(apiKey, '[fixture-key]')}`
  );
  if (creationAttempted && (await ownedContainer())) {
    try {
      console.error(
        (await docker('logs', '--tail', '100', name)).replaceAll(apiKey, '[fixture-key]')
      );
    } catch {
      /* Diagnostics must not prevent cleanup. */
    }
  }
} finally {
  if (creationAttempted && (await ownedContainer())) {
    try {
      await docker('container', 'rm', '--force', name);
    } catch (error) {
      failure ??= new Error(`Owned smoke container cleanup failed: ${error.message}`);
    }
  }
}
if (failure) throw failure;
console.log(JSON.stringify(result));
