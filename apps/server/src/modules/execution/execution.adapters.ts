import { Inject, Injectable } from '@nestjs/common';
import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
import type { SettingsService } from '../../services/settings-service.js';
import { boundRuntime } from '../../services/execution-environment/bound-runtime.js';
import type { ExecutionEnvironment } from '../../services/execution-environment/runtime.js';
import type {
  ExecutionAdapter,
  ExecutionCapability,
  ExecutionEnvironmentType,
  ResolvedExecutionBinding,
} from './execution.port.js';

const BASE_CAPABILITIES = Object.freeze([
  'files',
  'exec',
  'git',
  'preview',
  'tests',
  'memory',
] satisfies ExecutionCapability[]);

abstract class BoundExecutionAdapter implements ExecutionAdapter {
  abstract readonly type: ExecutionEnvironmentType;
  abstract readonly capabilities: ReadonlySet<ExecutionCapability>;

  private readonly hostEnvironment: Readonly<NodeJS.ProcessEnv>;
  constructor(
    @Inject('EXECUTION_SETTINGS') private readonly settings: SettingsService,
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>
  ) {
    this.hostEnvironment = captureNativeLocalEnvironment(environment);
  }

  open(binding: ResolvedExecutionBinding): Promise<ExecutionEnvironment> {
    return boundRuntime(binding.binding, this.settings, this.hostEnvironment);
  }
}

@Injectable()
export class LocalExecutionAdapter extends BoundExecutionAdapter {
  readonly type = 'local' as const;
  readonly capabilities = new Set<ExecutionCapability>([...BASE_CAPABILITIES, 'interactive-pty']);
}

@Injectable()
export class DockerExecutionAdapter extends BoundExecutionAdapter {
  readonly type = 'docker' as const;
  readonly capabilities = new Set<ExecutionCapability>(BASE_CAPABILITIES);
}

@Injectable()
export class SshExecutionAdapter extends BoundExecutionAdapter {
  readonly type = 'ssh' as const;
  readonly capabilities = new Set<ExecutionCapability>(BASE_CAPABILITIES);
}
