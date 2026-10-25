import type { ExecutionEnvironmentBinding } from '@automaker/types';
import type { SettingsService } from '../settings-service.js';
import {
  ExecutionEnvironmentError,
  issueEnvironment,
  type ExecutionEnvironment,
} from './runtime.js';
import { LocalExecutionEnvironment } from './local.js';
import { DockerExecutionEnvironment, ManagedDocker } from './docker.js';
import { ManagedSSH, SSHExecutionEnvironment } from './ssh.js';

/** Resolve capabilities from a verified server binding, never from request JSON. */
export async function boundRuntime(
  binding: ExecutionEnvironmentBinding,
  settings: SettingsService,
  hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<ExecutionEnvironment> {
  if (binding.type === 'ssh') {
    if (!binding.ssh || !binding.runtimeCwd)
      throw new ExecutionEnvironmentError(
        'INVALID_RUNTIME',
        'Pinned SSH descriptor is unavailable. No Local fallback was performed.'
      );
    return issueEnvironment(
      new SSHExecutionEnvironment(new ManagedSSH(settings), binding.ssh, binding.runtimeCwd)
    );
  }
  if (binding.type === 'docker') {
    if (!binding.docker)
      throw new ExecutionEnvironmentError(
        'INVALID_RUNTIME',
        'Pinned Docker descriptor is unavailable. No Local fallback was performed.'
      );
    return issueEnvironment(
      new DockerExecutionEnvironment(
        new ManagedDocker(settings),
        binding.docker,
        binding.runtimeCwd ?? binding.cwd
      )
    );
  }
  return issueEnvironment(
    await LocalExecutionEnvironment.create(binding.runtimeCwd ?? binding.cwd, hostEnvironment)
  );
}
