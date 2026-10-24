import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  cp,
  chmod,
  symlink,
  rm,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  inspectBackendDowngrade,
  DOWNGRADE_TARGET,
  downgradeExitCode,
} from '../check-backend-downgrade.mjs';

const CLI = fileURLToPath(new URL('../check-backend-downgrade.mjs', import.meta.url));
const stamp = '2026-10-24T00:00:00.000Z';
const runId = '01020304-0506-4708-890a-0b0c0d0e0f10';
const prompt = { id: 'prompt', message: 'private-prompt-fixture', addedAt: stamp };
const user = {
  id: 'message',
  role: 'user',
  content: 'private-history-fixture',
  timestamp: stamp,
  runId,
};
const deletion = (phase) => ({ version: 1, sessionId: 'session', phase, createdAt: stamp });
const delivery = (phase, disposition) => ({
  version: 1,
  sessionId: 'session',
  deliveryId: runId,
  createdAt: stamp,
  phase,
  ...(disposition ? { disposition } : {}),
  prompt,
});
const execution = (phase, status) => ({
  version: 1,
  sessionId: 'session',
  runId,
  createdAt: stamp,
  phase,
  ...(status ? { status } : {}),
  ...(phase !== 'settled' ? { userMessage: user } : {}),
  ...(phase === 'completing' ? { messages: [{ ...user, executionStatus: status }] } : {}),
});

async function owned(testContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-downgrade-fixture-'));
  testContext.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function json(root, relative, value) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
}
const inspect = (dataDirectory) =>
  inspectBackendDowngrade({ dataDirectory, target: DOWNGRADE_TARGET });
const importIntent = (phase) => ({
  version: 1,
  source: '/private/legacy-profile',
  phase,
  directories: ['agent-sessions'],
  files: [{ relative: 'settings.json', hash: 'a'.repeat(64) }],
  skipped: [],
});

for (const phase of ['staging', 'publishing'])
  test(`blocks pending legacy import (${phase}) without exposing source`, async (t) => {
    const root = await owned(t);
    await json(root, '.legacy-electron-import/intent.json', importIntent(phase));
    const before = await manifest(root),
      report = await inspect(root);
    assert.equal(report.status, 'blocked');
    assert.equal(report.findings[0].code, 'PENDING_LEGACY_IMPORT');
    assert.ok(!JSON.stringify(report).includes('/private/legacy-profile'));
    assert.deepEqual(await manifest(root), before);
  });
test('allows a valid complete legacy import intent without asserting full binary compatibility', async (t) => {
  const root = await owned(t);
  await json(root, '.legacy-electron-import/intent.json', importIntent('complete'));
  const before = await manifest(root),
    report = await inspect(root);
  assert.equal(report.status, 'passed');
  assert.deepEqual(await manifest(root), before);
});
for (const [name, record] of [
  ['unknown version', { ...importIntent('publishing'), version: 99 }],
  [
    'invalid manifest',
    { ...importIntent('staging'), files: [{ relative: '../escape', hash: 'a'.repeat(64) }] },
  ],
  ['unknown phase', { ...importIntent('complete'), phase: 'unrecognized' }],
  ['relative source', { ...importIntent('complete'), source: 'relative-profile' }],
])
  test(`treats ${name} legacy import intent as unconfirmed`, async (t) => {
    const root = await owned(t);
    await json(root, '.legacy-electron-import/intent.json', record);
    assert.equal((await inspect(root)).status, 'unconfirmed');
  });
test('does not silently pass a legacy import folder with no readable intent', async (t) => {
  const root = await owned(t);
  await json(root, '.legacy-electron-import/payload/settings.json', {});
  assert.equal((await inspect(root)).status, 'unconfirmed');
  await writeFile(path.join(root, '.legacy-electron-import/intent.json'), 'private-corrupt-intent');
  const report = await inspect(root);
  assert.equal(report.status, 'unconfirmed');
  assert.ok(!JSON.stringify(report).includes('private-corrupt-intent'));
});
async function manifest(root, relative = '') {
  const files = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const item = path.join(relative, name),
      stat = await lstat(path.join(root, item));
    if (stat.isDirectory()) files.push(...(await manifest(root, item)));
    else if (stat.isFile())
      files.push({
        path: item,
        hash: createHash('sha256')
          .update(await readFile(path.join(root, item)))
          .digest('hex'),
        mode: stat.mode & 0o777,
      });
    else files.push({ path: item, type: 'unsupported' });
  }
  return files;
}
async function cli(args, cwd, extraEnv = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    error = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    error += String(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  return { code, output, error };
}

test('passes clean legacy data, empty safety directories and known legacy backups without writes', async (t) => {
  const root = await owned(t);
  for (const name of ['agent-session-deletions', 'agent-queue-deliveries', 'agent-executions'])
    await mkdir(path.join(root, name));
  await json(root, 'agent-sessions/session.json', [
    { id: 'old', role: 'assistant', content: 'legacy', timestamp: stamp },
  ]);
  await json(root, 'agent-sessions/session-queue.json', [prompt]);
  await json(root, 'agent-sessions/session-queue.json.bak1', [prompt]);
  await json(root, 'sessions-metadata.json', { session: { id: 'session' } });
  await json(root, 'sessions-metadata.json.bak1.tmp.123.0123abcd', {});
  const before = await manifest(root),
    report = await inspect(root);
  assert.equal(report.status, 'passed');
  assert.equal(downgradeExitCode(report), 0);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(await manifest(root), before);
});

for (const [kind, directory, record] of [
  ['deleting', 'agent-session-deletions', deletion('deleting')],
  ['deleted', 'agent-session-deletions', deletion('deleted')],
  ['claimed', 'agent-queue-deliveries', delivery('claimed')],
  ['interrupted', 'agent-queue-deliveries', delivery('settled', 'interrupted')],
  ['consumed', 'agent-queue-deliveries', delivery('settled', 'consumed')],
  ['running', 'agent-executions', execution('running')],
  ['completing', 'agent-executions', execution('completing', 'completed')],
  ['settled', 'agent-executions', execution('settled', 'completed')],
])
  test(`rejects ${kind} ledger without requiring a main queue or metadata file`, async (t) => {
    const root = await owned(t);
    await json(root, `${directory}/session.json`, record);
    const before = await manifest(root),
      report = await inspect(root);
    assert.equal(report.status, 'blocked');
    assert.equal(downgradeExitCode(report), 2);
    assert.equal(report.findings[0].code, 'UNSUPPORTED_SAFETY_LEDGER');
    assert.deepEqual(await manifest(root), before);
    assert.ok(!JSON.stringify(report).includes('private-'));
  });

for (const suffix of [
  '',
  '.bak1',
  '.tmp.123.0123abcd',
  '.bak2.tmp.123.0123abcd.tmp.456.0123abcd',
]) {
  test(`rejects quarantined queue in main/backup/temp artifact ${suffix || '(main)'}`, async (t) => {
    const root = await owned(t);
    await json(root, `agent-sessions/session-queue.json${suffix}`, [
      { ...prompt, deliveryStatus: 'interrupted', deliveryId: runId },
    ]);
    const before = await manifest(root),
      report = await inspect(root);
    assert.equal(report.status, 'blocked');
    assert.equal(report.findings[0].code, 'UNSUPPORTED_AGENT_SAFETY_FIELDS');
    assert.deepEqual(await manifest(root), before);
  });
}

test('rejects delivery/run safety fields left in history even if every journal is absent', async (t) => {
  const root = await owned(t);
  await json(root, 'agent-sessions/session.json.bak1', [user]);
  assert.equal((await inspect(root)).status, 'blocked');
});

for (const [name, relative, value] of [
  [
    'unknown version',
    'agent-session-deletions/session.json',
    { ...deletion('deleted'), version: 2 },
  ],
  [
    'mismatched ID',
    'agent-executions/session.json',
    { ...execution('running'), sessionId: 'another' },
  ],
  [
    'invalid execution intent',
    'agent-executions/session.json',
    { ...execution('completing', 'completed'), messages: [] },
  ],
  [
    'missing delivery payload',
    'agent-queue-deliveries/session.json',
    { ...delivery('claimed'), prompt: null },
  ],
  ['unknown metadata', 'sessions-metadata.json', []],
  ['unknown queue', 'agent-sessions/session-queue.json.bak1', {}],
  ['reserved identifier', 'agent-session-deletions/constructor.json', deletion('deleted')],
])
  test(`reports ${name} as unconfirmed rather than passing`, async (t) => {
    const root = await owned(t);
    await json(root, relative, value);
    const before = await manifest(root),
      report = await inspect(root);
    assert.equal(report.status, 'unconfirmed');
    assert.equal(downgradeExitCode(report), 3);
    assert.deepEqual(await manifest(root), before);
  });

test('does not repair corrupt primary files from clean backups', async (t) => {
  const root = await owned(t);
  await json(root, 'agent-sessions/session-queue.json.bak1', []);
  await writeFile(path.join(root, 'agent-sessions/session-queue.json'), 'private-invalid-json');
  const before = await manifest(root),
    report = await inspect(root);
  assert.equal(report.status, 'unconfirmed');
  assert.equal(report.findings[0].code, 'INVALID_JSON');
  assert.ok(!JSON.stringify(report).includes('private-invalid-json'));
  assert.deepEqual(await manifest(root), before);
});

test('inspects a journal present only as an atomic backup/temp artifact', async (t) => {
  const root = await owned(t);
  await json(
    root,
    'agent-queue-deliveries/session.json.bak1.tmp.123.0123abcd',
    delivery('claimed')
  );
  assert.equal((await inspect(root)).status, 'blocked');
});

test('reports ambiguous artifact names and non-file safety entries as unconfirmed', async (t) => {
  const root = await owned(t);
  await mkdir(path.join(root, 'agent-executions', 'session.json'), { recursive: true });
  await json(root, 'agent-queue-deliveries/ambiguous.tmp.other', delivery('claimed'));
  await json(root, 'sessions-metadata.json.tmp.other', {});
  const report = await inspect(root);
  assert.equal(report.status, 'unconfirmed');
  assert.ok(report.findings.some(({ code }) => code === 'UNSUPPORTED_ARTIFACT'));
  assert.ok(report.findings.some(({ code }) => code === 'UNRECOGNIZED_SAFETY_ARTIFACT'));
  assert.ok(report.findings.some(({ code }) => code === 'UNRECOGNIZED_METADATA_ARTIFACT'));
});

test('does not follow a safety-directory symlink or inspect outside the owned profile', async (t) => {
  const root = await owned(t),
    outside = await owned(t);
  await json(outside, 'session.json', deletion('deleted'));
  await symlink(
    outside,
    path.join(root, 'agent-session-deletions'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const before = await manifest(outside),
    report = await inspect(root);
  assert.equal(report.status, 'unconfirmed');
  assert.equal(report.scannedFiles, 0);
  assert.deepEqual(await manifest(outside), before);
});

test('requires explicit existing DATA_DIR and a supported capability target', async (t) => {
  const root = await owned(t);
  await assert.rejects(inspectBackendDowngrade({ target: DOWNGRADE_TARGET }));
  await assert.rejects(
    inspectBackendDowngrade({ dataDirectory: root, target: 'some-older-version' })
  );
  assert.equal((await inspect(path.join(root, 'missing'))).status, 'unconfirmed');
  const result = await cli([], root, { DATA_DIR: root });
  assert.equal(result.code, 64);
  assert.equal(result.output, '');
});

test('CLI returns reason metadata only and never changes unsafe storage', async (t) => {
  const root = await owned(t);
  await json(root, 'agent-queue-deliveries/session.json', delivery('settled', 'interrupted'));
  await chmod(path.join(root, 'agent-queue-deliveries/session.json'), 0o600);
  const before = await manifest(root);
  const result = await cli(['--data-dir', root, '--target', DOWNGRADE_TARGET], root);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.output).status, 'blocked');
  assert.equal(result.error, '');
  assert.ok(!result.output.includes('private-prompt-fixture'));
  assert.deepEqual(await manifest(root), before);
});

test('full baseline snapshot restores into a fresh sibling; overlay leaves blockers behind', async (t) => {
  const root = await owned(t),
    baseline = path.join(root, 'baseline'),
    snapshot = path.join(root, 'snapshot'),
    upgraded = path.join(root, 'upgraded'),
    restored = path.join(root, 'restored'),
    overlay = path.join(root, 'overlay');
  await mkdir(baseline);
  await json(baseline, 'sessions-metadata.json', {
    session: { id: 'session', name: 'Before upgrade' },
  });
  await json(baseline, 'sessions-metadata.json.bak1', {});
  await json(baseline, 'agent-sessions/session.json', [
    { id: 'baseline', role: 'user', content: 'Baseline', timestamp: stamp },
  ]);
  await json(baseline, 'agent-sessions/session-queue.json', [prompt]);
  await json(baseline, 'settings.json', { theme: 'dark', unrelated: 'retained' });
  await json(baseline, 'credentials.json', { secret: 'private-credential-fixture' });
  await cp(baseline, snapshot, { recursive: true, preserveTimestamps: true });
  const original = await manifest(snapshot);
  await cp(snapshot, upgraded, { recursive: true });
  await json(upgraded, 'agent-session-deletions/session.json', deletion('deleting'));
  await json(upgraded, 'agent-queue-deliveries/session.json', delivery('claimed'));
  await json(upgraded, 'agent-executions/session.json', execution('completing', 'completed'));
  await json(upgraded, 'agent-sessions/session-queue.json', [
    { ...prompt, deliveryStatus: 'interrupted' },
  ]);
  const upgradedBefore = await manifest(upgraded);
  const refused = await cli(['--data-dir', upgraded, '--target', DOWNGRADE_TARGET], root);
  assert.equal(refused.code, 2);
  assert.deepEqual(await manifest(upgraded), upgradedBefore);
  await cp(upgraded, overlay, { recursive: true });
  await cp(snapshot, overlay, { recursive: true, force: true });
  assert.equal((await inspect(overlay)).status, 'blocked');
  await cp(snapshot, restored, { recursive: true, preserveTimestamps: true });
  assert.deepEqual(await manifest(restored), original);
  const accepted = await cli(['--data-dir', restored, '--target', DOWNGRADE_TARGET], root);
  assert.equal(accepted.code, 0);
  assert.equal(JSON.parse(accepted.output).status, 'passed');
  const restoredQueue = JSON.parse(
    await readFile(path.join(restored, 'agent-sessions/session-queue.json'), 'utf8')
  );
  assert.equal(restoredQueue.length, 1);
  assert.equal(restoredQueue[0].id, prompt.id);
  assert.deepEqual(await manifest(restored), original);
  assert.deepEqual(await manifest(upgraded), upgradedBefore);
  assert.deepEqual(await manifest(snapshot), original);
});
