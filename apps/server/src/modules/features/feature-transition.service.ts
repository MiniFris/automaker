import { Injectable } from '@nestjs/common';
import { ValidationDomainError } from '../../core/errors/index.js';

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
const COMPLETION_STATUSES = new Set(['verified', 'completed']);

@Injectable()
export class FeatureTransitionService {
  assertAllowed(target: unknown): asserts target is string | undefined {
    if (target === undefined) return;
    if (
      typeof target !== 'string' ||
      (!MANAGED_STATUSES.has(target) && !/^pipeline_[A-Za-z0-9._-]+$/.test(target))
    ) {
      throw new ValidationDomainError(`Unsupported feature status: ${String(target)}`);
    }
  }

  isNewCompletion(previous: unknown, target: unknown): target is 'verified' | 'completed' {
    return typeof target === 'string' && COMPLETION_STATUSES.has(target) && previous !== target;
  }
}
