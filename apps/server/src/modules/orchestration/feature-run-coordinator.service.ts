import type { ConcurrencyManager, RunningFeature } from '../../services/concurrency-manager.js';
import { ValidationDomainError } from '../../core/errors/index.js';
import { canTransitionFeatureRun, type FeatureRunState } from './feature-run-state-machine.js';
import type { FeatureRunPort } from '../../services/agent-executor-types.js';

/** Stateless coordinator: ConcurrencyManager owns every run and its mutation lane. */
export class FeatureRunCoordinator {
  bind(manager: ConcurrencyManager, run: RunningFeature): FeatureRunPort {
    const assertCurrent = () => {
      if (!manager.isCurrent(run) || run.executionUncertain) {
        const error = new Error('Feature run was superseded');
        error.name = 'AbortError';
        throw error;
      }
    };
    return {
      assertCurrent,
      mutate: async (write) => {
        assertCurrent();
        if (!(await this.mutate(manager, run, write))) assertCurrent();
        assertCurrent();
      },
      transition: (state) => {
        assertCurrent();
        if (run.state === 'queued' && state !== 'queued')
          this.transition(manager, run, 'preparing');
        this.transition(manager, run, state);
      },
    };
  }
  transition(manager: ConcurrencyManager, run: RunningFeature, state: FeatureRunState): boolean {
    if (!manager.isCurrent(run) || run.executionUncertain) return false;
    if (!canTransitionFeatureRun(run.state, state))
      throw new ValidationDomainError(`Invalid feature run transition: ${run.state} -> ${state}`);
    run.state = state;
    return true;
  }

  acceptCompletion(manager: ConcurrencyManager, run: RunningFeature, eventId: string): boolean {
    if (!manager.isCurrent(run) || run.executionUncertain || run.completedEvents.has(eventId))
      return false;
    run.completedEvents.add(eventId);
    return true;
  }

  mutate(
    manager: ConcurrencyManager,
    run: RunningFeature,
    write: () => Promise<unknown>
  ): Promise<boolean> {
    if (!manager.isCurrent(run) || run.executionUncertain) return Promise.resolve(false);
    run.pendingMutations++;
    const accepted = run.mutationTail
      .catch(() => {})
      .then(async () => {
        if (run.executionUncertain) return false;
        await write();
        return true;
      });
    run.mutationTail = accepted.finally(() => manager.finishMutation(run));
    return run.mutationTail as Promise<boolean>;
  }

  status(
    manager: ConcurrencyManager,
    run: RunningFeature,
    status: string,
    write: () => Promise<unknown>
  ): Promise<boolean> {
    return this.mutate(manager, run, async () => {
      const target: FeatureRunState =
        status === 'interrupted'
          ? 'interrupted'
          : status === 'backlog' || status === 'merge_conflict'
            ? 'failed'
            : status === 'verified' || status === 'completed'
              ? 'completed'
              : status === 'waiting_approval'
                ? 'awaiting_review'
                : 'executing';
      if (run.state === 'queued') run.state = 'preparing';
      if (run.state === 'preparing' && target !== 'interrupted' && target !== 'failed')
        run.state = 'executing';
      // A terminal run can receive a repeated interruption while its abort settles.
      if (run.state !== target && !canTransitionFeatureRun(run.state, target))
        throw new ValidationDomainError(
          `Invalid feature run transition: ${run.state} -> ${target}`
        );
      await write();
      run.state = target;
    });
  }
}
