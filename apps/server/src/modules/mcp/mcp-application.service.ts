import type { MCPServerInput } from './application.inputs.js';

import { MCPTestService } from '../../services/mcp-test-service.js';

export class MCPApplicationService {
  constructor(private readonly mcp: MCPTestService) {}

  test(input: MCPServerInput) {
    return this.mcp.testConnectionById(input.serverId);
  }

  async tools(input: MCPServerInput) {
    const result = await this.mcp.listToolsById(input.serverId);

    return {
      success: result.success,
      tools: result.tools,
      error: result.error,
    };
  }
}
