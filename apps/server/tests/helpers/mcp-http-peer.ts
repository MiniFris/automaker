import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { MCP_FRAME_BYTES } from '../../src/services/mcp/operation.js';

/** Private actual-SDK protocol peer. No tools/authentication/external requests. */
export async function mcpHTTPPeer(type: 'http' | 'sse', mode = 'success') {
  const sessions = new Map<
    string,
    { transport: SSEServerTransport | StreamableHTTPServerTransport; server: Server }
  >();
  const responses = new Set<ServerResponse>();
  const responseTypes: string[] = [];
  const requests: Array<{ method: string; url: string; authorization?: string }> = [];
  const releases: Array<() => void> = [];
  let lists = 0;
  const build = () => {
    const server = new Server(
      { name: 'private-mcp-peer', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      lists++;
      if (mode === 'hang-list') await new Promise<void>((resolve) => releases.push(resolve));
      if (mode === 'error')
        throw new McpError(
          ErrorCode.InternalError,
          'fixture-header-secret unconfigured-private-payload'
        );
      return {
        tools:
          mode === 'empty'
            ? []
            : [
                {
                  name: 'fixture_read',
                  inputSchema: { type: 'object' },
                  description:
                    mode === 'oversize-list'
                      ? 'x'.repeat(MCP_FRAME_BYTES + 100)
                      : 'Private fixture',
                },
              ],
      };
    });
    return server;
  };
  const listener = createServer((request, response) => {
    void (async () => {
      requests.push({
        method: request.method!,
        url: request.url!,
        authorization: request.headers.authorization,
      });
      responses.add(response);
      // Hono writes headers directly with writeHead, which need not populate getHeader().
      // Observe the actual SDK-produced Content-Type without changing any arguments.
      const writeHead = response.writeHead.bind(response);
      response.writeHead = ((...args: unknown[]) => {
        const raw = typeof args[1] === 'string' ? args[2] : args[1];
        let contentType: unknown;
        if (Array.isArray(raw)) {
          const at = raw.findIndex((value) => String(value).toLowerCase() === 'content-type');
          if (at >= 0) contentType = raw[at + 1];
        } else if (raw && typeof raw === 'object') {
          contentType = Object.entries(raw).find(
            ([name]) => name.toLowerCase() === 'content-type'
          )?.[1];
        }
        responseTypes.push(String(contentType ?? response.getHeader('content-type') ?? ''));
        return Reflect.apply(writeHead, response, args);
      }) as ServerResponse['writeHead'];
      response.once('close', () => responses.delete(response));
      if (mode === 'hang-connect') return;
      if (mode === 'raw-error') {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('fixture-header-secret unconfigured-private-payload');
        return;
      }
      if (mode === 'unterminated') {
        response.writeHead(200, {
          'content-type': type === 'sse' ? 'text/event-stream' : 'application/json',
        });
        response.write(type === 'sse' ? 'data: ' : '{"jsonrpc":"2.0","result":"');
        response.write('x'.repeat(MCP_FRAME_BYTES + 100));
        return;
      }
      if (type === 'sse') {
        if (request.method === 'GET') {
          const transport = new SSEServerTransport('/messages', response),
            server = build();
          sessions.set(transport.sessionId, { transport, server });
          await server.connect(transport);
          return;
        }
        const session = new URL(request.url!, 'http://fixture').searchParams.get('sessionId');
        const entry = session ? sessions.get(session) : undefined;
        if (!entry) {
          response.writeHead(404);
          response.end();
          return;
        }
        await (entry.transport as SSEServerTransport).handlePostMessage(request, response);
        return;
      }
      const id = request.headers['mcp-session-id'];
      let entry = typeof id === 'string' ? sessions.get(id) : undefined;
      if (!entry && request.method === 'POST') {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: mode === 'json',
          }),
          server = build();
        entry = { transport, server };
        await server.connect(transport);
        await transport.handleRequest(request, response);
        if (transport.sessionId) sessions.set(transport.sessionId, entry);
        return;
      }
      if (!entry) {
        response.writeHead(404);
        response.end();
        return;
      }
      await (entry.transport as StreamableHTTPServerTransport).handleRequest(request, response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  return {
    url: `http://127.0.0.1:${(listener.address() as { port: number }).port}/${type === 'http' ? 'mcp' : 'sse'}`,
    requests,
    responseTypes,
    responses,
    get lists() {
      return lists;
    },
    async close() {
      releases.splice(0).forEach((release) => release());
      await Promise.allSettled([...sessions.values()].map((entry) => entry.server.close()));
      for (const response of responses) response.destroy();
      await new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
        listener.closeAllConnections();
      });
    },
  };
}
