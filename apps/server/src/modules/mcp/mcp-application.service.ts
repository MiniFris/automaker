import { Inject, Injectable } from '@nestjs/common';
import { LEGACY_SERVICES } from '../../legacy/legacy.tokens.js';
import type { MCPTestService } from '../../services/mcp-test-service.js';
import type { MCPServerRequest } from './mcp.schemas.js';

@Injectable()
export class MCPApplicationService {
  constructor(@Inject(LEGACY_SERVICES.mcpTest) private readonly mcp: MCPTestService) {}

  test(input: MCPServerRequest) {
    return this.mcp.testServerById(input.serverId);
  }

  async tools(input: MCPServerRequest) {
    const result = await this.mcp.testServerById(input.serverId);

    return {
      success: result.success,
      tools: result.tools,
      error: result.error,
    };
  }
}
