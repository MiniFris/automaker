import { Injectable } from '@nestjs/common';
import { ConflictDomainError, ValidationDomainError } from '../../core/errors/index.js';
import {
  canTransitionFeatureRun,
  type FeatureRunState,
  isTerminalFeatureRunState,
} from './feature-run-state-machine.js';

interface OwnedRun {
  ownerId: string;
  state: FeatureRunState;
  completedEvents: Set<string>;
}

@Injectable()
export class FeatureRunCoordinator {
  private readonly runs = new Map<string, OwnedRun>();

  claim(runId: string, ownerId: string, initialState: FeatureRunState = 'queued'): void {
    const existing = this.runs.get(runId);
    if (existing && existing.ownerId !== ownerId) {
      throw new ConflictDomainError(`Feature run ${runId} already has an owner`);
    }
    if (!existing)
      this.runs.set(runId, { ownerId, state: initialState, completedEvents: new Set() });
  }

  transition(runId: string, ownerId: string, target: FeatureRunState): void {
    const run = this.requireOwner(runId, ownerId);
    if (!canTransitionFeatureRun(run.state, target)) {
      throw new ValidationDomainError(`Invalid feature run transition: ${run.state} -> ${target}`);
    }
    run.state = target;
  }

  acceptCompletion(runId: string, ownerId: string, eventId: string): boolean {
    const run = this.requireOwner(runId, ownerId);
    if (run.completedEvents.has(eventId)) return false;
    run.completedEvents.add(eventId);
    return true;
  }

  release(runId: string, ownerId: string): void {
    const run = this.requireOwner(runId, ownerId);
    if (!isTerminalFeatureRunState(run.state)) {
      throw new ValidationDomainError(`Cannot release active feature run ${runId} in ${run.state}`);
    }
    this.runs.delete(runId);
  }

  state(runId: string): FeatureRunState | undefined {
    return this.runs.get(runId)?.state;
  }

  private requireOwner(runId: string, ownerId: string): OwnedRun {
    const run = this.runs.get(runId);
    if (!run || run.ownerId !== ownerId) {
      throw new ConflictDomainError(`Feature run ${runId} is not owned by ${ownerId}`);
    }
    return run;
  }
}
