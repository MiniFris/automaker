import { Injectable } from '@nestjs/common';
import { ValidationDomainError } from '../../core/errors/index.js';
import { mapLegacyFeatureStatus } from '../orchestration/feature-run-state-machine.js';

const MANAGED_STATUSES = new Set([
  'backlog',
  'pending',
  'ready',
  'running',
  'in_progress',
  'interrupted',
  'failed',
  'merge_conflict',
  'waiting_approval',
  'verified',
  'completed',
]);

@Injectable()
export class FeatureTransitionService {
  assertAllowed(target: unknown): asserts target is string | undefined {
    if (target === undefined) return;
    if (
      typeof target !== 'string' ||
      (!MANAGED_STATUSES.has(target) && !mapLegacyFeatureStatus(target))
    ) {
      throw new ValidationDomainError(`Unsupported feature status: ${String(target)}`);
    }
  }

  isNewCompletion(previous: unknown, target: unknown): target is 'verified' | 'completed' {
    return (
      (target === 'verified' || target === 'completed') &&
      mapLegacyFeatureStatus(previous) !== 'completed'
    );
  }
}
