import { Controller, Get, Inject, Res, ServiceUnavailableException } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { Public } from '../auth/index.js';
import { HOST_ENVIRONMENT, RUNTIME_CONFIG, type RuntimeConfig } from '../config/index.js';
import { ReadinessStateService } from '../lifecycle/readiness-state.service.js';
import { getVersion } from '../../lib/version.js';

@Controller('health')
export class HealthController {
  private readonly embeddedInstanceId?: string;
  constructor(
    @Inject(ReadinessStateService) private readonly readiness: ReadinessStateService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(HOST_ENVIRONMENT) environment: Readonly<NodeJS.ProcessEnv>
  ) {
    const value = environment.AUTOMAKER_EMBEDDED_SERVER_ID;
    if (
      value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    )
      this.embeddedInstanceId = value;
  }

  @Public()
  @Get()
  index(): { status: 'ok'; timestamp: string; version: string } {
    return { status: 'ok', timestamp: new Date().toISOString(), version: getVersion() };
  }

  @Public()
  @Get('environment')
  environment(): { isContainerized: boolean; skipSandboxWarning?: boolean } {
    return {
      isContainerized: this.config.execution.containerized,
      skipSandboxWarning: this.config.execution.skipSandboxWarning,
    };
  }

  @Public()
  @Get('live')
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
  @Public()
  @Get('ready')
  ready(): { status: 'ready'; timestamp: string } {
    if (!this.readiness.snapshot().ready)
      throw new ServiceUnavailableException('Application is not ready.');
    return { status: 'ready', timestamp: new Date().toISOString() };
  }

  @Get('detailed')
  detailed(@Res({ passthrough: true }) response: ServerResponse): Record<string, unknown> {
    if (this.embeddedInstanceId)
      response.setHeader('x-automaker-instance-id', this.embeddedInstanceId);
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: getVersion(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dataDir: this.config.storage.dataDirectory,
      auth: {
        enabled: !this.config.auth.disabled,
        method: this.config.auth.disabled ? 'disabled' : 'api_key_or_session',
      },
      env: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
    };
  }
}
