import type { ExecutionEnvironmentBinding } from '@automaker/types';
import type { ExecutionEnvironment } from '../../services/execution-environment/runtime.js';

export type ExecutionCapability =
  | 'files'
  | 'exec'
  | 'interactive-pty'
  | 'git'
  | 'preview'
  | 'tests'
  | 'memory';

export type ExecutionEnvironmentType = 'local' | 'docker' | 'ssh';

export interface ResolvedExecutionBinding {
  readonly binding: Readonly<ExecutionEnvironmentBinding>;
  readonly type: ExecutionEnvironmentType;
  readonly targetId: string;
  readonly projectPath: string;
  readonly controllerCwd: string;
  readonly runtimeCwd: string;
  readonly authoritativeRoot: string;
}

export interface ExecutionAdapter {
  readonly type: ExecutionEnvironmentType;
  readonly capabilities: ReadonlySet<ExecutionCapability>;
  open(binding: ResolvedExecutionBinding): Promise<ExecutionEnvironment>;
}

export interface ExecutionAdapterDescriptor {
  readonly type: ExecutionEnvironmentType;
  readonly capabilities: readonly ExecutionCapability[];
}

export const EXECUTION_ADAPTERS = Symbol('EXECUTION_ADAPTERS');
