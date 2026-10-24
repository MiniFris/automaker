import { Inject, Injectable } from '@nestjs/common';
import { MCPTestService } from '../../services/mcp-test-service.js';
import type { MCPServerRequest } from './mcp.schemas.js';

@Injectable()
export class MCPApplicationService {
  constructor(@Inject(MCPTestService) private readonly mcp: MCPTestService) {}

  test(input: MCPServerRequest) {
    return this.mcp.testConnectionById(input.serverId);
  }

  async tools(input: MCPServerRequest) {
    const result = await this.mcp.listToolsById(input.serverId);

    return {
      success: result.success,
      tools: result.tools,
      error: result.error,
    };
  }
}
