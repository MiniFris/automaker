import { Module } from '@nestjs/common';
import { MCPApplicationService } from './mcp-application.service.js';
import { MCPController } from './mcp.controller.js';
import { SettingsService } from '../../services/settings-service.js';
import { MCPTestService } from '../../services/mcp-test-service.js';

@Module({
  controllers: [MCPController],
  providers: [
    {
      provide: MCPTestService,
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => new MCPTestService(settings),
    },
    MCPApplicationService,
  ],
  exports: [MCPApplicationService, MCPTestService],
})
export class MCPModule {}
