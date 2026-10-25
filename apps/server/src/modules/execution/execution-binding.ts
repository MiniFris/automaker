import type { ExecutionEnvironmentBinding } from '@automaker/types';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import type { ExecutionEnvironmentType, ResolvedExecutionBinding } from './execution.port.js';

function bindingType(binding: ExecutionEnvironmentBinding): ExecutionEnvironmentType {
  if (binding.type === 'legacy' || binding.type === 'local') return 'local';
  if (binding.type === 'docker' || binding.type === 'ssh') return binding.type;
  throw new ExecutionEnvironmentError('INVALID_BINDING', 'Unsupported execution binding.');
}

export function resolveImmutableBinding(
  binding: ExecutionEnvironmentBinding
): ResolvedExecutionBinding {
  const type = bindingType(binding);
  if (binding.version !== 1 || !binding.id || !binding.projectPath || !binding.cwd) {
    throw new ExecutionEnvironmentError('INVALID_BINDING', 'Execution binding is incomplete.');
  }
  if (type === 'docker' && !binding.docker) {
    throw new ExecutionEnvironmentError(
      'INVALID_BINDING',
      'Docker binding is incomplete. No Local fallback was performed.'
    );
  }
  if (type === 'ssh' && (!binding.ssh || !binding.runtimeCwd)) {
    throw new ExecutionEnvironmentError(
      'INVALID_BINDING',
      'SSH binding is incomplete. No Local fallback was performed.'
    );
  }
  const snapshot = Object.freeze(globalThis.structuredClone(binding));
  return Object.freeze({
    binding: snapshot,
    type,
    targetId: snapshot.id,
    projectPath: snapshot.projectPath,
    controllerCwd: snapshot.cwd,
    runtimeCwd: snapshot.runtimeCwd ?? snapshot.cwd,
    authoritativeRoot: snapshot.ssh?.remotePath ?? snapshot.runtimeCwd ?? snapshot.cwd,
  });
}
