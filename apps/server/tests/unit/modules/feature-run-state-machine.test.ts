import { describe, expect, it } from 'vitest';
import { FeatureRunCoordinator } from '../../../src/modules/orchestration/feature-run-coordinator.service.js';
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
    coordinator.claim('feature-1', 'worker-1');
    expect(() => coordinator.claim('feature-1', 'worker-2')).toThrow('already has an owner');
    coordinator.transition('feature-1', 'worker-1', 'preparing');
    expect(coordinator.acceptCompletion('feature-1', 'worker-1', 'event-1')).toBe(true);
    expect(coordinator.acceptCompletion('feature-1', 'worker-1', 'event-1')).toBe(false);
  });
});
