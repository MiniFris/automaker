import { describe, expect, it } from 'vitest';
import { FeatureRunCoordinator } from '../../../src/modules/orchestration/feature-run-coordinator.service.js';
import { ConcurrencyManager } from '../../../src/services/concurrency-manager.js';
import {
  canTransitionFeatureRun,
  FEATURE_RUN_TRANSITIONS,
  mapLegacyFeatureStatus,
} from '../../../src/modules/orchestration/feature-run-state-machine.js';

describe('feature run state machine', () => {
  it('accepts every documented transition and rejects terminal replay', () => {
    for (const [from, targets] of Object.entries(FEATURE_RUN_TRANSITIONS)) {
      for (const target of targets) {
        expect(canTransitionFeatureRun(from as never, target)).toBe(true);
      }
    }
    expect(canTransitionFeatureRun('completed', 'executing')).toBe(false);
    expect(canTransitionFeatureRun('backlog', 'completed')).toBe(false);
  });

  it('maps legacy public statuses without changing the UI contract', () => {
    expect(mapLegacyFeatureStatus('pending')).toBe('queued');
    expect(mapLegacyFeatureStatus('waiting_approval')).toBe('awaiting_approval');
    expect(mapLegacyFeatureStatus('pipeline_review')).toBe('executing');
    expect(mapLegacyFeatureStatus('verified')).toBe('completed');
    expect(mapLegacyFeatureStatus('unknown')).toBeUndefined();
  });

  it('enforces one owner and idempotent completion events', () => {
    const coordinator = new FeatureRunCoordinator();
    const manager = new ConcurrencyManager(undefined, coordinator);
    const run = manager.acquire({
      projectPath: '/project',
      featureId: 'feature-1',
      isAutoMode: false,
    });
    expect(() =>
      manager.acquire({ projectPath: '/project', featureId: 'feature-1', isAutoMode: false })
    ).toThrow('already running');
    coordinator.transition(manager, run, 'preparing');
    expect(coordinator.acceptCompletion(manager, run, 'event-1')).toBe(true);
    expect(coordinator.acceptCompletion(manager, run, 'event-1')).toBe(false);
  });

  it('ignores late completion and release of A after stop and acquisition of B', async () => {
    const manager = new ConcurrencyManager();
    const input = { projectPath: '/project', featureId: 'feature', isAutoMode: false };
    const first = manager.acquire(input);
    manager.release(input.featureId, { force: true, expected: first });
    const second = await manager.acquireAsync(input);
    manager.release(input.featureId, { expected: first });
    expect(manager.getRunningFeature(input.featureId)).toBe(second);
    expect(manager.coordinator.acceptCompletion(manager, first, 'done')).toBe(false);
    let changed = false;
    expect(
      await manager.coordinator.status(manager, first, 'verified', async () => {
        changed = true;
      })
    ).toBe(false);
    expect(changed).toBe(false);
    expect(second.state).toBe('queued');
    expect(() => manager.acquire({ ...input, allowReuse: true, expected: first })).toThrow(
      'superseded'
    );
  });

  it('drains an accepted status write before admitting the next incarnation', async () => {
    const manager = new ConcurrencyManager();
    const input = { projectPath: '/project', featureId: 'feature', isAutoMode: false };
    const first = manager.acquire(input);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const writing = manager.coordinator.status(manager, first, 'in_progress', async () => {
      await held;
      order.push('old-write');
    });
    manager.release(input.featureId, { force: true, expected: first });
    let admitted = false;
    const admission = manager.acquireAsync(input).then((run) => {
      admitted = true;
      order.push('new-run');
      return run;
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    expect(manager.isRunning(input.featureId)).toBe(false);
    release();
    await writing;
    const second = await admission;
    expect(order).toEqual(['old-write', 'new-run']);
    expect(second.incarnation).not.toBe(first.incarnation);
  });
});
