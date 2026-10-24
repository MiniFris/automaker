#!/usr/bin/env node

import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DOWNGRADE_TARGET = 'legacy-no-agent-ledgers';
const SCOPE = 'legacy-agent-storage-preflight';
const SUFFIX = '(?:\\.bak[1-9][0-9]*)?(?:\\.tmp\\.[0-9]+\\.[a-f0-9]{8})*';
const SESSION = /^[A-Za-z0-9_-]{1,255}$/;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sessionId = (value) =>
  typeof value === 'string' &&
  SESSION.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value) &&
  !value.endsWith('-queue');
const message = (value) =>
  plainObject(value) &&
  typeof value.id === 'string' &&
  ['user', 'assistant'].includes(value.role) &&
  typeof value.content === 'string' &&
  typeof value.timestamp === 'string';
const prompt = (value) =>
  plainObject(value) &&
  typeof value.id === 'string' &&
  typeof value.message === 'string' &&
  typeof value.addedAt === 'string';
const terminal = (value) => ['completed', 'failed', 'cancelled'].includes(value);
const IMPORT_ITEMS = [
  'settings.json',
  'credentials.json',
  'sessions-metadata.json',
  'agent-sessions',
  '.api-key',
  '.sessions',
];
const importRelative = (value) =>
  typeof value === 'string' &&
  IMPORT_ITEMS.includes(value.split('/')[0]) &&
  value.split('/').every((part) => !!part && part !== '.' && part !== '..' && !/[\\\0]/.test(part));
function importIntentValid(value) {
  return (
    plainObject(value) &&
    value.version === 1 &&
    typeof value.source === 'string' &&
    path.isAbsolute(value.source) &&
    ['staging', 'publishing', 'complete'].includes(value.phase) &&
    Array.isArray(value.directories) &&
    value.directories.every(importRelative) &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        plainObject(file) &&
        importRelative(file.relative) &&
        typeof file.hash === 'string' &&
        /^[a-f0-9]{64}$/.test(file.hash)
    ) &&
    Array.isArray(value.skipped) &&
    value.skipped.every((item) => IMPORT_ITEMS.includes(item))
  );
}

function journalValid(kind, value, id) {
  if (
    !plainObject(value) ||
    value.version !== 1 ||
    value.sessionId !== id ||
    typeof value.createdAt !== 'string'
  )
    return false;
  if (kind === 'deletion')
    return (
      ['deleting', 'deleted'].includes(value.phase) &&
      (value.completedAt === undefined || typeof value.completedAt === 'string')
    );
  if (kind === 'delivery')
    return (
      typeof value.deliveryId === 'string' &&
      !!value.deliveryId &&
      prompt(value.prompt) &&
      ((value.phase === 'claimed' && value.disposition === undefined) ||
        (value.phase === 'settled' && ['consumed', 'interrupted'].includes(value.disposition))) &&
      (value.consumedPromptIds === undefined ||
        (Array.isArray(value.consumedPromptIds) &&
          value.consumedPromptIds.every((item) => typeof item === 'string'))) &&
      (value.blockedDeliveries === undefined ||
        (Array.isArray(value.blockedDeliveries) &&
          value.blockedDeliveries.every(
            (item) =>
              plainObject(item) &&
              typeof item.promptId === 'string' &&
              typeof item.deliveryId === 'string'
          )))
    );
  if (
    typeof value.runId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.runId) ||
    (value.sdkSessionId !== undefined && typeof value.sdkSessionId !== 'string')
  )
    return false;
  if (value.phase === 'settled') return terminal(value.status) || value.status === 'interrupted';
  if (
    !message(value.userMessage) ||
    value.userMessage.role !== 'user' ||
    value.userMessage.runId !== value.runId
  )
    return false;
  if (value.phase === 'running') return true;
  return (
    value.phase === 'completing' &&
    terminal(value.status) &&
    Array.isArray(value.messages) &&
    value.messages.every(message) &&
    value.messages.some(
      (item) =>
        item.role === 'user' &&
        item.runId === value.runId &&
        item.id === value.userMessage.id &&
        item.deliveryId === value.userMessage.deliveryId &&
        item.queuedPromptId === value.userMessage.queuedPromptId &&
        item.executionStatus === value.status
    )
  );
}

/** Read-only inspection of an explicit stopped profile or consistent snapshot. */
export async function inspectBackendDowngrade({ dataDirectory, target } = {}) {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || target !== DOWNGRADE_TARGET)
    throw new Error('Explicit data directory and supported target are required.');
  const root = path.resolve(dataDirectory);
  const report = {
    schemaVersion: 1,
    scope: SCOPE,
    target,
    status: 'passed',
    scannedFiles: 0,
    findings: [],
  };
  const finding = (code, file, kind, unconfirmed = false, phase) => {
    report.findings.push({ code, path: file, kind, ...(phase ? { phase } : {}) });
    if (unconfirmed) report.status = 'unconfirmed';
    else if (report.status !== 'unconfirmed') report.status = 'blocked';
  };
  const stat = async (file) => {
    try {
      return await lstat(path.join(root, file));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      finding('UNREADABLE_PATH', file || '.', 'filesystem', true);
      return null;
    }
  };
  const directory = async (file, required = false) => {
    const entry = await stat(file);
    if (entry === undefined) {
      if (required) finding('MISSING_DATA_DIRECTORY', '.', 'filesystem', true);
      return undefined;
    }
    if (entry === null) return undefined;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      finding('UNSUPPORTED_PATH', file || '.', 'filesystem', true);
      return undefined;
    }
    try {
      return await readdir(path.join(root, file));
    } catch {
      finding('UNREADABLE_DIRECTORY', file || '.', 'filesystem', true);
      return undefined;
    }
  };
  const json = async (file, kind) => {
    const entry = await stat(file);
    if (entry === null) return undefined;
    if (!entry || !entry.isFile() || entry.isSymbolicLink()) {
      finding('UNSUPPORTED_ARTIFACT', file, kind, true);
      return undefined;
    }
    let bytes;
    try {
      bytes = await readFile(path.join(root, file));
    } catch {
      finding('UNREADABLE_ARTIFACT', file, kind, true);
      return undefined;
    }
    report.scannedFiles++;
    const after = await stat(file);
    if (
      !after ||
      after.dev !== entry.dev ||
      after.ino !== entry.ino ||
      after.size !== entry.size ||
      after.mtimeMs !== entry.mtimeMs ||
      after.ctimeMs !== entry.ctimeMs
    ) {
      finding('ARTIFACT_CHANGED_DURING_SCAN', file, kind, true);
      return undefined;
    }
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      finding('INVALID_JSON', file, kind, true);
      return undefined;
    }
  };
  const names = await directory('', true);
  if (!names) return report;
  const imports = await directory('.legacy-electron-import');
  if (imports) {
    const file = '.legacy-electron-import/intent.json';
    if (!imports.includes('intent.json'))
      finding('MISSING_IMPORT_INTENT', file, 'legacy-import', true);
    else {
      const value = await json(file, 'legacy-import');
      if (value !== undefined) {
        if (!importIntentValid(value))
          finding('UNKNOWN_IMPORT_INTENT', file, 'legacy-import', true);
        else if (value.phase !== 'complete')
          finding('PENDING_LEGACY_IMPORT', file, 'legacy-import', false, value.phase);
      }
    }
  }
  for (const [subdirectory, kind] of [
    ['agent-session-deletions', 'deletion'],
    ['agent-queue-deliveries', 'delivery'],
    ['agent-executions', 'execution'],
  ]) {
    const files = await directory(subdirectory);
    if (!files) continue;
    for (const file of files.sort()) {
      const relative = `${subdirectory}/${file}`;
      const match = new RegExp(`^(.+)\\.json${SUFFIX}$`).exec(file);
      if (!match || !sessionId(match[1])) {
        finding('UNRECOGNIZED_SAFETY_ARTIFACT', relative, kind, true);
        continue;
      }
      const value = await json(relative, kind);
      if (value === undefined) continue;
      if (!journalValid(kind, value, match[1])) {
        finding('UNKNOWN_SAFETY_RECORD', relative, kind, true);
        continue;
      }
      // The target does not understand these ledgers, including settled records.
      finding('UNSUPPORTED_SAFETY_LEDGER', relative, kind, false, value.phase);
    }
  }
  const sessions = await directory('agent-sessions');
  if (sessions)
    for (const file of sessions.sort()) {
      const match = new RegExp(`^(.+?)(-queue)?\\.json${SUFFIX}$`).exec(file);
      if (!match || !sessionId(match[1])) {
        finding('UNRECOGNIZED_SESSION_ARTIFACT', `agent-sessions/${file}`, 'sessions', true);
        continue;
      }
      const kind = match[2] ? 'queue' : 'messages';
      const relative = `agent-sessions/${file}`;
      const value = await json(relative, kind);
      if (value === undefined) continue;
      if (!Array.isArray(value) || !value.every(kind === 'queue' ? prompt : message)) {
        finding('UNKNOWN_SESSION_RECORD', relative, kind, true);
        continue;
      }
      if (
        value.some((item) =>
          kind === 'queue'
            ? Object.hasOwn(item, 'deliveryStatus') || Object.hasOwn(item, 'deliveryId')
            : ['deliveryId', 'queuedPromptId', 'deliveryStatus', 'runId', 'executionStatus'].some(
                (key) => Object.hasOwn(item, key)
              )
        )
      )
        finding('UNSUPPORTED_AGENT_SAFETY_FIELDS', relative, kind);
    }
  for (const file of names.filter((name) => name.startsWith('sessions-metadata.json')).sort()) {
    if (!new RegExp(`^sessions-metadata\\.json${SUFFIX}$`).test(file)) {
      finding('UNRECOGNIZED_METADATA_ARTIFACT', file, 'metadata', true);
      continue;
    }
    const value = await json(file, 'metadata');
    if (value === undefined) continue;
    if (
      !plainObject(value) ||
      !Object.entries(value).every(
        ([id, item]) => sessionId(id) && plainObject(item) && item.id === id
      )
    )
      finding('UNKNOWN_METADATA_RECORD', file, 'metadata', true);
  }
  return report;
}

export function downgradeExitCode(report) {
  return report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 3;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--data-dir' || args[2] !== '--target') {
    console.error(
      'Usage: node scripts/check-backend-downgrade.mjs --data-dir <stopped-profile-or-snapshot> --target legacy-no-agent-ledgers'
    );
    process.exitCode = 64;
    return;
  }
  try {
    const report = await inspectBackendDowngrade({ dataDirectory: args[1], target: args[3] });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = downgradeExitCode(report);
  } catch {
    console.error('Explicit data directory and supported target are required.');
    process.exitCode = 64;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main();
