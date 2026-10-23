import { writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const [mode, pidPath] = process.argv.slice(2);
writeFileSync(pidPath, String(process.pid));
// A silent server still drains stdin and exits when the client closes it.
process.stdin.on('end', () => process.exit(0));
if (mode === 'hang-connect') {
  process.stdin.resume();
} else {
  const server = new Server(
    { name: 'automaker-contract-mcp', version: '1.0.0' },
    {
      capabilities: { tools: {} },
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (mode === 'hang-list') return new Promise(() => {});
    if (mode === 'oversized')
      return {
        tools: Array.from({ length: 1001 }, (_, index) => ({
          name: `tool_${index}`,
          inputSchema: { type: 'object' },
        })),
      };
    if (mode === 'fail')
      throw new McpError(ErrorCode.InternalError, `Rejected ${process.env.TEST_MCP_SECRET}`);
    return {
      tools: [
        { name: 'fixture_read', description: 'Reads a fixture', inputSchema: { type: 'object' } },
      ],
    };
  });
  await server.connect(new StdioServerTransport());
}
