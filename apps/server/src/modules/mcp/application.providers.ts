import type { FactoryProvider } from '@nestjs/common';
import { MCPApplicationService } from './mcp-application.service.js';
import { MCPTestService } from '../../services/mcp-test-service.js';

export const mCPApplicationServiceProvider: FactoryProvider<MCPApplicationService> = {
  provide: MCPApplicationService,
  inject: [MCPTestService],
  useFactory: (mcp: ConstructorParameters<typeof MCPApplicationService>[0]) =>
    new MCPApplicationService(mcp),
};
