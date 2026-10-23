import { Module } from '@nestjs/common';
import { MCPApplicationService } from './mcp-application.service.js';
import { MCPController } from './mcp.controller.js';

@Module({
  controllers: [MCPController],
  providers: [MCPApplicationService],
  exports: [MCPApplicationService],
})
export class MCPModule {}
