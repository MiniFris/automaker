import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FeatureExecutionIntents } from '../../../src/services/feature-execution-intents.js';
import { ConcurrencyManager } from '../../../src/services/concurrency-manager.js';
import {
  FeatureExecutionUncertainError,
  uncertainExecution,
} from '../../../src/services/feature-execution-uncertainty.js';
import { ExecutionEnvironmentError } from '../../../src/services/execution-environment/runtime.js';
import { ProviderCleanupError } from '../../../src/providers/provider-execution-scope.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feature-intents-'));
  roots.push(root);
  const identity = { projectPath: path.join(root, 'project'), featureId: 'fixture' };
  const store = new FeatureExecutionIntents(root, fs as never),
    manager = new ConcurrencyManager(undefined, undefined, store);
  return { root, identity, store, manager };
}
it('write-ahead pending survives a fresh store and mismatched settlement never erases it', async () => {
  const f = await fixture();
  const id = await f.store.begin(f.identity, 'pipeline_step');
  const fresh = new FeatureExecutionIntents(f.root, fs as never);
  await expect(fresh.assertAllowed(f.identity)).rejects.toBeInstanceOf(
    FeatureExecutionUncertainError
  );
  await expect(f.store.settle(f.identity, 'foreign-operation')).rejects.toBeInstanceOf(
    FeatureExecutionUncertainError
  );
  await expect(fresh.assertAllowed(f.identity)).rejects.toThrow(/unconfirmed/);
  await f.store.settle(f.identity, id);
  await f.store.close();
  await expect(fresh.close()).rejects.toThrow(/unconfirmed/);
});
it('confirmed ordinary failure clears its intent and permits a later run', async () => {
  const f = await fixture(),
    run = await f.manager.acquireAsync({ ...f.identity, isAutoMode: false });
  await expect(
    f.manager.executeOwned(run, 'execution', async () => {
      throw new Error('confirmed model failure');
    })
  ).rejects.toThrow('confirmed model failure');
  f.manager.release(run.featureId, { expected: run });
  const next = await f.manager.acquireAsync({ ...f.identity, isAutoMode: false });
  expect(next).not.toBe(run);
  expect(await fs.readdir(path.join(f.root, 'feature-execution-intents'))).toHaveLength(0);
  await f.store.close();
});
it('unknown cleanup keeps nested leases and durable gate despite normal/forced release and refuses completion writes', async () => {
  const f = await fixture(),
    run = await f.manager.acquireAsync({ ...f.identity, isAutoMode: false });
  f.manager.acquire({ ...f.identity, isAutoMode: false, allowReuse: true, expected: run });
  await expect(
    f.manager.executeOwned(run, 'pipeline_step', async () => {
      throw new ProviderCleanupError();
    })
  ).rejects.toBeInstanceOf(ProviderCleanupError);
  f.manager.release(run.featureId, { expected: run });
  f.manager.release(run.featureId, { expected: run, force: true });
  expect(f.manager.getRunningFeature(run.featureId)).toBe(run);
  expect(f.manager.coordinator.acceptCompletion(f.manager, run, 'late')).toBe(false);
  let wrote = false;
  expect(
    await f.manager.coordinator.status(f.manager, run, 'completed', async () => {
      wrote = true;
    })
  ).toBe(false);
  expect(wrote).toBe(false);
  await expect(
    f.manager.acquireAsync({ ...f.identity, isAutoMode: false, allowReuse: true, expected: run })
  ).rejects.toThrow(/unconfirmed/);
  await expect(f.store.close()).rejects.toThrow(/unconfirmed/);
});
it('unreadable/malformed private intent blocks admission rather than assuming empty state', async () => {
  const f = await fixture(),
    id = await f.store.begin(f.identity, 'merge');
  const directory = path.join(f.root, 'feature-execution-intents'),
    [name] = await fs.readdir(directory);
  await fs.writeFile(path.join(directory, name), 'not-json');
  let dispatched = false;
  await expect(
    f.manager.acquireAsync({ ...f.identity, isAutoMode: false }).then(() => {
      dispatched = true;
    })
  ).rejects.toThrow(/unconfirmed/);
  expect(dispatched).toBe(false);
  expect(id).toBeTruthy();
  await expect(f.store.close()).rejects.toThrow(/unconfirmed/);
});
it('classifies only verified unknown/cleanup codes, preserving confirmed worker failures and cancellation', () => {
  for (const code of [
    'DOCKER_WORKER_FAILED',
    'PROCESS_CLEANUP_FAILED',
    'SSH_OUTCOME_UNKNOWN',
    'SSH_CLEANUP_UNVERIFIED',
  ])
    expect(uncertainExecution(new ExecutionEnvironmentError(code, 'private'))).toBe(true);
  for (const code of [
    'ENVIRONMENT_IO_ERROR',
    'PROCESS_INTERRUPTED',
    'SSH_OPERATION_RUNNING',
    'SSH_PREFLIGHT_FAILED',
  ])
    expect(uncertainExecution(new ExecutionEnvironmentError(code, 'confirmed'))).toBe(false);
  expect(
    uncertainExecution(Object.assign(new Error('unknown'), { code: 'DOCKER_WORKER_FAILED' }))
  ).toBe(false);
  expect(uncertainExecution(new DOMException('cancel', 'AbortError'))).toBe(false);
});
