import { describe, expect, it, vi } from 'vitest';

import { MCPApplicationService } from '../../../src/modules/mcp/mcp-application.service.js';

describe('MCPApplicationService', () => {
  it('tests only a saved server selected by id', async () => {
    const mcp = {
      testConnectionById: vi.fn().mockResolvedValue({
        success: true,
        tools: [{ name: 'read_file', enabled: true }],
        connectionTime: 12,
      }),
    };
    const service = new MCPApplicationService(mcp as never);

    await expect(service.test({ serverId: 'saved-server' })).resolves.toMatchObject({
      success: true,
      connectionTime: 12,
    });
    expect(mcp.testConnectionById).toHaveBeenCalledWith('saved-server');
  });

  it('projects tool discovery onto the existing HTTP response contract', async () => {
    const tools = [{ name: 'read_file', enabled: true }];
    const mcp = {
      listToolsById: vi.fn().mockResolvedValue({
        success: true,
        tools,
        connectionTime: 12,
      }),
    };
    const service = new MCPApplicationService(mcp as never);

    await expect(service.tools({ serverId: 'saved-server' })).resolves.toEqual({
      success: true,
      tools,
      error: undefined,
    });
  });
});
