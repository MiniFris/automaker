import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const [mode, pidPath] = process.argv.slice(2);
writeFileSync(pidPath, String(process.pid));
// A silent server still drains stdin and exits when the client closes it.
process.stdin.on('end', () => process.exit(0));
if (mode === 'oversize-frame' || mode === 'stderr-flood') {
  (mode === 'oversize-frame' ? process.stdout : process.stderr).write(
    'x'.repeat(mode === 'oversize-frame' ? 2 * 1024 * 1024 + 100 : 64 * 1024 + 100)
  );
  process.stdin.resume();
} else if (mode === 'hang-connect') {
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
    if (mode === 'tree') {
      const child = spawn(
        process.execPath,
        ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        { stdio: 'ignore' }
      );
      writeFileSync(pidPath + '.child', String(child.pid));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (mode === 'environment')
      return {
        tools: [
          {
            name: 'environment',
            description: JSON.stringify({
              HOME: process.env.HOME,
              PATH: process.env.PATH,
              OVERRIDE: process.env.MCP_OVERRIDE,
              AUTOMAKER_API_KEY: process.env.AUTOMAKER_API_KEY,
              DATA_DIR: process.env.DATA_DIR,
              PORT: process.env.PORT,
              NODE_PATH: process.env.NODE_PATH,
            }),
            inputSchema: { type: 'object' },
          },
        ],
      };
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
