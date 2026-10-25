import { ProviderCleanupError } from '../providers/provider-execution-scope.js';
import { ExecutionEnvironmentError } from './execution-environment/runtime.js';
import { UnknownOutcomeDomainError } from '../core/errors/domain-errors.js';

export const FEATURE_UNCERTAIN_REASON =
  'Feature execution outcome or cleanup is unconfirmed. Inspect the workspace and execution intent before explicit recovery; no operation was replayed.';
export class FeatureExecutionUncertainError extends UnknownOutcomeDomainError {
  readonly code = 'FEATURE_OUTCOME_UNKNOWN';
  constructor() {
    super(FEATURE_UNCERTAIN_REASON);
  }
}
export function uncertainExecution(error: unknown): boolean {
  if (error instanceof FeatureExecutionUncertainError || error instanceof ProviderCleanupError)
    return true;
  // Worker failure is emitted only for a disconnected worker/non-JSON response;
  // confirmed worker errors instead keep their specific response.error.code.
  return (
    error instanceof ExecutionEnvironmentError &&
    [
      'PROCESS_CLEANUP_FAILED',
      'SSH_OUTCOME_UNKNOWN',
      'SSH_CLEANUP_UNVERIFIED',
      'DOCKER_WORKER_FAILED',
    ].includes(error.code)
  );
}
