export type OperationKind =
  | 'startup'
  | 'agent_execution'
  | 'agent_mutation'
  | 'feature_execution'
  | 'execution_command'
  | 'mcp_inspection';

export interface OperationIdentity {
  readonly sessionId?: string;
  readonly featureId?: string;
  readonly executionType?: 'legacy' | 'local' | 'docker' | 'ssh';
}

export type OperationOutcome = 'completed' | 'error' | 'cancelled' | 'unknown';

/** Trusted dependency, never a field on a transport request or persisted binding. */
export type ObserveOperation = <T>(
  kind: OperationKind,
  task: () => Promise<T>,
  identity?: OperationIdentity,
  signal?: AbortSignal,
  outcome?: (result: T) => OperationOutcome
) => Promise<T>;

export const unobservedOperation: ObserveOperation = (_kind, task) => task();
