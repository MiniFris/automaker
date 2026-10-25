#!/usr/bin/env node

// Private offline artifact acceptance. Never mount an operator DATA_DIR or pull images.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(
    'Usage: node scripts/smoke-backend-upgrade.mjs --old-image <local-image> --new-image <local-image>'
  );
  process.exit(0);
}
assert.ok(
  args.length === 4 && args[0] === '--old-image' && args[2] === '--new-image' && args[1] && args[3],
  'Explicit --old-image and --new-image required'
);
const exec = promisify(execFile);
const owner = randomUUID(),
  apiKey = randomUUID();
const prefix = `automaker-upgrade-${owner}`;
const label = 'automaker.acceptance.owner';
const volumes = [],
  containers = [];
const network = `${prefix}-offline`;
let networkAttempted = false;
let stage = 'inspect artifacts',
  failure,
  result;
const clean = (text) => String(text).replaceAll(apiKey, '[fixture-key]');
async function docker(...argv) {
  return (
    await exec('docker', argv, { encoding: 'utf8', timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })
  ).stdout.trim();
}
async function owned(kind, name) {
  let raw;
  try {
    raw = await docker(kind, 'inspect', name);
  } catch (error) {
    if (/no such (container|volume|network)/i.test(String(error.stderr))) return null;
    throw error;
  }
  const [item] = JSON.parse(raw);
  assert.equal(
    (kind === 'container' ? item.Config.Labels : item.Labels)?.[label],
    owner,
    `Ownership mismatch: ${kind} ${name}`
  );
  return item;
}
async function volume(suffix) {
  const name = `${prefix}-${suffix}`;
  volumes.push(name);
  await docker('volume', 'create', '--label', `${label}=${owner}`, name);
  assert.ok(await owned('volume', name));
  return name;
}
async function create(name, image, flags, command = []) {
  containers.push(name);
  await docker(
    'create',
    '--pull=never',
    '--name',
    name,
    '--label',
    `${label}=${owner}`,
    ...flags,
    image,
    ...command
  );
  const item = await owned('container', name);
  assert.equal(item.Image, image);
  for (const mount of item.Mounts) {
    assert.equal(mount.Type, 'volume', 'Only private named volumes are allowed');
    assert.ok(volumes.includes(mount.Name), 'Unexpected volume');
    assert.ok(await owned('volume', mount.Name));
  }
}
async function helper(image, mounts, code) {
  const name = `${prefix}-helper-${containers.length}`;
  await create(
    name,
    image,
    [
      '--network',
      'none',
      '--entrypoint',
      'node',
      '--user',
      '0',
      ...mounts.flatMap(([name, target, readonly]) => [
        '--mount',
        `type=volume,src=${name},dst=${target}${readonly ? ',readonly' : ''}`,
      ]),
    ],
    ['-e', code]
  );
  await docker('start', '--attach', name);
  const item = await owned('container', name);
  assert.equal(item.State.ExitCode, 0, 'Private snapshot helper failed');
  return docker('logs', name);
}
// Preserve complete copied profile: bytes, modes, ownership and timestamps. Reject symlinks
// rather than following anything outside the private snapshot graph.
const fileTools = `
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function manifest(root) {
 const entries=[];
 function visit(relative) {
  const file=path.join(root,relative),s=fs.lstatSync(file);
  if (!s.isDirectory()&&!s.isFile()) throw Error('Unexpected non-regular snapshot entry');
  entries.push({path:relative,type:s.isDirectory()?'directory':'file',mode:s.mode&4095,uid:s.uid,gid:s.gid,...(s.isFile()?{size:s.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}:{})});
  if(s.isDirectory()) for(const name of fs.readdirSync(file).sort()) visit(path.join(relative,name));
 }
 visit('');return entries;
}
function copy(from,to) {
 const s=fs.lstatSync(from);
 if(s.isDirectory()) {fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from))copy(path.join(from,name),path.join(to,name));}
 else if(s.isFile())fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
 else throw Error('Unexpected non-regular snapshot entry');
 fs.chownSync(to,s.uid,s.gid);fs.chmodSync(to,s.mode&4095);fs.utimesSync(to,s.atime,s.mtime);
}
`;
async function snapshot(image, from, to) {
  return JSON.parse(
    await helper(
      image,
      [
        [from, '/source', true],
        [to, '/target', false],
      ],
      fileTools +
        `
if(fs.readdirSync('/target').length)throw Error('Snapshot destination must be empty');
const before=manifest('/source');copy('/source','/target');
const after=manifest('/target');require('node:assert/strict').deepEqual(after,before);
console.log(JSON.stringify({entries:after.length,files:after.filter(x=>x.type==='file').length,manifestHash:crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex')}));`
    )
  );
}
async function profileManifest(image, data) {
  return JSON.parse(
    await helper(
      image,
      [[data, '/source', true]],
      fileTools +
        `console.log(JSON.stringify({manifestHash:crypto.createHash('sha256').update(JSON.stringify(manifest('/source'))).digest('hex')}));`
    )
  );
}
async function boot(image, data, suffix) {
  const name = `${prefix}-${suffix}`;
  await create(name, image, [
    '--network',
    network,
    '--publish',
    '127.0.0.1::3008',
    '--mount',
    `type=volume,src=${data},dst=/data`,
    ...Object.entries({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3008',
      AUTOMAKER_API_KEY: apiKey,
      ENABLE_REQUEST_LOGGING: 'false',
      DATA_DIR: '/data',
      ALLOWED_ROOT_DIRECTORY: '/data',
      HOME: '/data/home',
      XDG_CONFIG_HOME: '/data/config',
      XDG_CACHE_HOME: '/data/cache',
    }).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
  ]);
  await docker('start', name);
  return connect(name);
}
async function connect(name) {
  const item = await owned('container', name);
  const [binding] = item.NetworkSettings.Ports['3008/tcp'];
  assert.equal(binding.HostIp, '127.0.0.1');
  const base = `http://127.0.0.1:${binding.HostPort}/api/`;
  async function request(route, body, method = body === undefined ? 'GET' : 'POST', status = 200) {
    const response = await fetch(base + route, {
      method,
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, status, `${route}: unexpected status`);
    return response.json();
  }
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + 'health/ready', { signal: AbortSignal.timeout(1000) });
      ready = response.status === 200 && (await response.json()).status === 'ready';
    } catch {
      /* listener starting */
    }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, 'Artifact did not become ready in 30 seconds');
  assert.equal((await request('health/detailed')).status, 'ok');
  return { name, request };
}
async function stop(app) {
  assert.ok(await owned('container', app.name));
  await docker('stop', '--time', '30', app.name);
  const item = await owned('container', app.name);
  assert.equal(item.State.Running, false);
  assert.equal(item.State.ExitCode, 0);
  assert.equal(item.State.OOMKilled, false);
}
const project = '/data/project',
  baselineId = `baseline-${owner}`,
  addedId = `upgrade-${owner}`;
async function verify(app, upgraded) {
  const global = await app.request('settings/global');
  assert.equal(global.settings.theme, upgraded ? 'light' : 'dark');
  const local = await app.request('settings/project', { projectPath: project });
  assert.equal(local.settings.testCommand, upgraded ? 'printf upgraded' : 'printf baseline');
  const feature = await app.request('features/get', {
    projectPath: project,
    featureId: baselineId,
  });
  assert.equal(
    feature.feature.description,
    upgraded ? 'Updated by new artifact' : 'Existing installation baseline'
  );
  if (upgraded)
    assert.equal(
      (await app.request('features/get', { projectPath: project, featureId: addedId })).feature
        .title,
      'Upgrade addition'
    );
  else await app.request('features/get', { projectPath: project, featureId: addedId }, 'POST', 404);
}
try {
  const oldImage = await docker('image', 'inspect', '--format', '{{.Id}}', args[1]);
  const newImage = await docker('image', 'inspect', '--format', '{{.Id}}', args[3]);
  for (const id of [oldImage, newImage]) assert.match(id, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(oldImage, newImage, 'Upgrade acceptance requires different artifacts');
  stage = 'create private volumes';
  networkAttempted = true;
  await docker('network', 'create', '--label', `${label}=${owner}`, network);
  const isolatedNetwork = await owned('network', network);
  assert.equal(isolatedNetwork.Driver, 'bridge');
  const data = await volume('data'),
    backup = await volume('snapshot'),
    restored = await volume('rollback');
  stage = 'seed existing installation using old artifact APIs';
  const old = await boot(oldImage, data, 'old');
  await docker(
    'exec',
    '--user',
    'automaker',
    old.name,
    'node',
    '-e',
    "require('node:fs').mkdirSync('/data/project',{recursive:true})"
  );
  await old.request('settings/global', { theme: 'dark' }, 'PUT');
  await old.request(
    'settings/project',
    { projectPath: project, updates: { testCommand: 'printf baseline' } },
    'PUT'
  );
  await old.request('features/create', {
    projectPath: project,
    feature: {
      id: baselineId,
      title: 'Upgrade baseline',
      description: 'Existing installation baseline',
      status: 'backlog',
    },
  });
  await verify(old, false);
  await stop(old);
  stage = 'snapshot stopped baseline volume';
  const saved = await snapshot(oldImage, data, backup);
  stage = 'upgrade existing volume';
  const current = await boot(newImage, data, 'new');
  await verify(current, false);
  await current.request('settings/global', { theme: 'light' }, 'PUT');
  await current.request(
    'settings/project',
    { projectPath: project, updates: { testCommand: 'printf upgraded' } },
    'PUT'
  );
  await current.request('features/update', {
    projectPath: project,
    featureId: baselineId,
    updates: { description: 'Updated by new artifact' },
  });
  await current.request('features/create', {
    projectPath: project,
    feature: {
      id: addedId,
      title: 'Upgrade addition',
      description: 'New artifact write',
      status: 'backlog',
    },
  });
  await verify(current, true);
  await stop(current);
  stage = 'restart upgraded artifact against same volume';
  await docker('start', current.name);
  const restarted = await connect(current.name);
  await verify(restarted, true);
  await stop(restarted);
  const preservedUpgrade = await profileManifest(oldImage, data);
  stage = 'restore complete prior snapshot into separate volume';
  const restoredManifest = await snapshot(oldImage, backup, restored);
  assert.equal(restoredManifest.manifestHash, saved.manifestHash);
  stage = 'boot selected old artifact against restored baseline';
  const rollback = await boot(oldImage, restored, 'rollback');
  await verify(rollback, false);
  await stop(rollback);
  assert.equal(
    (await profileManifest(oldImage, data)).manifestHash,
    preservedUpgrade.manifestHash,
    'Rollback must not alter preserved upgraded data'
  );
  assert.equal(
    (await profileManifest(oldImage, backup)).manifestHash,
    saved.manifestHash,
    'Rollback must not alter baseline snapshot'
  );
  result = {
    oldImage: args[1],
    oldImageId: oldImage,
    newImage: args[3],
    newImageId: newImage,
    seededSettingsAndFeature: true,
    upgradeSameVolume: true,
    upgradedWritesPersistAfterRestart: true,
    baselineSnapshot: saved,
    restoredSnapshotByteModeOwnershipMatch: true,
    oldArtifactReadsRestoredBaseline: true,
    upgradeAndSnapshotPreserved: true,
    sigtermExitCodes: [0, 0, 0, 0],
  };
} catch (error) {
  failure = new Error(`Private upgrade acceptance failed at ${stage}: ${clean(error.message)}`);
} finally {
  for (const name of [...containers].reverse()) {
    try {
      if (await owned('container', name)) await docker('container', 'rm', '--force', name);
    } catch (error) {
      failure ??= new Error(`Owned container cleanup failed: ${clean(error.message)}`);
    }
  }
  for (const name of [...volumes].reverse()) {
    try {
      if (await owned('volume', name)) await docker('volume', 'rm', name);
    } catch (error) {
      failure ??= new Error(`Owned volume cleanup failed: ${clean(error.message)}`);
    }
  }
  if (networkAttempted) {
    try {
      if (await owned('network', network)) await docker('network', 'rm', network);
    } catch (error) {
      failure ??= new Error(`Owned network cleanup failed: ${clean(error.message)}`);
    }
  }
}
if (failure) throw failure;
console.log(JSON.stringify({ ...result, ownedResourcesRemoved: true }));
