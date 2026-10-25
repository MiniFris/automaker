import { HOST_ENVIRONMENT, RuntimePathsService } from '../../core/config/index.js';
import { Module } from '@nestjs/common';
import { MCPApplicationService } from './mcp-application.service.js';
import { MCPController } from './mcp.controller.js';
import { SettingsService } from '../../services/settings-service.js';
import { MCPTestService } from '../../services/mcp-test-service.js';
import { ApplicationMetrics } from '../../core/observability/application-metrics.js';

@Module({
  controllers: [MCPController],
  providers: [
    {
      provide: MCPTestService,
      inject: [SettingsService, HOST_ENVIRONMENT, RuntimePathsService, ApplicationMetrics],
      useFactory: (
        settings: SettingsService,
        environment: Readonly<NodeJS.ProcessEnv>,
        paths: RuntimePathsService,
        metrics: ApplicationMetrics
      ) => {
        const service = new MCPTestService(settings, undefined, {
          environment,
          workingDirectory: paths.workingDirectory,
          observeOperation: (kind, task, identity, signal, classify) =>
            metrics.operation(kind, task, identity, signal, classify),
        });
        metrics.registerRuntimeGauge('mcp_active_operations', () => service.activeOperationCount);
        metrics.registerRuntimeGauge(
          'mcp_unconfirmed_operations',
          () => service.unconfirmedOperationCount
        );
        return service;
      },
    },
    MCPApplicationService,
  ],
  exports: [MCPApplicationService, MCPTestService],
})
export class MCPModule {}
