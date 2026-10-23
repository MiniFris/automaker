/**
 * MCP Test Service
 *
 * Provides functionality to test MCP server connections and list available tools.
 * Supports stdio, SSE, and HTTP transport types.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { MCPServerConfig, MCPToolInfo } from '@automaker/types';
import type { SettingsService } from './settings-service.js';

const execAsync = promisify(exec);
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const IS_WINDOWS = process.platform === 'win32';
type MCPTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

export interface MCPTestResult {
  success: boolean;
  tools?: MCPToolInfo[];
  error?: string;
  connectionTime?: number;
  serverInfo?: {
    name?: string;
    version?: string;
  };
}

/**
 * MCP Test Service for testing server connections and listing tools
 */
export class MCPTestService {
  private settingsService: SettingsService;
  private stopping = false;
  private readonly activeConnections = new Map<Client, MCPTransport>();
  private readonly closingConnections = new WeakMap<Client, Promise<void>>();

  constructor(
    settingsService: SettingsService,
    private readonly requestTimeoutMs = DEFAULT_TIMEOUT
  ) {
    this.settingsService = settingsService;
  }

  /**
   * Test connection to an MCP server and list its tools
   */
  async testServer(serverConfig: MCPServerConfig): Promise<MCPTestResult> {
    const startTime = Date.now();
    let client: Client | null = null;
    let transport:
      | StdioClientTransport
      | SSEClientTransport
      | StreamableHTTPClientTransport
      | null = null;

    try {
      if (this.stopping) throw new Error('MCP discovery is shutting down');
      client = new Client({
        name: 'automaker-mcp-test',
        version: '1.0.0',
      });

      // Create transport based on server type
      transport = await this.createTransport(serverConfig);
      if (this.stopping) throw new Error('MCP discovery is shutting down');
      this.activeConnections.set(client, transport);

      // Connect with timeout
      await this.withTimeout(client.connect(transport), 'Connection timeout');

      // List tools with timeout
      const toolsResult = await this.withTimeout(client.listTools(), 'List tools timeout');
      if (
        toolsResult.tools.length > 1000 ||
        Buffer.byteLength(JSON.stringify(toolsResult)) > 1024 * 1024
      ) {
        throw new Error('MCP tool catalog exceeds the allowed size');
      }

      const connectionTime = Date.now() - startTime;

      // Convert tools to MCPToolInfo format
      const tools: MCPToolInfo[] = (toolsResult.tools || []).map(
        (tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          enabled: true,
        })
      );

      return {
        success: true,
        tools,
        connectionTime,
        serverInfo: {
          name: client.getServerVersion()?.name ?? serverConfig.name,
          version: client.getServerVersion()?.version,
        },
      };
    } catch (error) {
      const connectionTime = Date.now() - startTime;
      return {
        success: false,
        error: this.getErrorMessage(error, serverConfig),
        connectionTime,
      };
    } finally {
      // Clean up client connection and ensure process termination
      await this.cleanupConnection(client, transport);
    }
  }

  /**
   * Clean up MCP client connection and terminate spawned processes
   *
   * On Windows, child processes spawned via 'cmd /c' don't get terminated when the
   * parent process is killed. We use taskkill with /t flag to kill the entire process tree.
   * This prevents orphaned MCP server processes that would spam logs with ping warnings.
   *
   * IMPORTANT: We must run taskkill BEFORE client.close() because:
   * - client.close() kills only the parent cmd.exe process
   * - This orphans the child node.exe processes before we can kill them
   * - taskkill /t needs the parent PID to exist to traverse the process tree
   */
  private async cleanupConnection(
    client: Client | null,
    transport: MCPTransport | null
  ): Promise<void> {
    if (!client) return;
    const existing = this.closingConnections.get(client);
    if (existing) return existing;
    const closing = this.closeConnection(client, transport).finally(() => {
      this.activeConnections.delete(client);
    });
    this.closingConnections.set(client, closing);
    return closing;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.activeConnections].map(([client, transport]) =>
        this.cleanupConnection(client, transport)
      )
    );
  }

  private async closeConnection(client: Client, transport: MCPTransport | null): Promise<void> {
    // Get the PID before any cleanup (only available for stdio transports)
    const pid = transport instanceof StdioClientTransport ? transport.pid : null;

    // On Windows with stdio transport, kill the entire process tree FIRST
    // This must happen before client.close() which would orphan child processes
    if (IS_WINDOWS && pid) {
      try {
        // taskkill /f = force, /t = kill process tree, /pid = process ID
        await execAsync(`taskkill /f /t /pid ${pid}`);
      } catch {
        // Process may have already exited, which is fine
      }
    }

    // Now do the standard close (may be a no-op if taskkill already killed everything)
    if (client) {
      try {
        await client.close();
      } catch {
        // Expected if taskkill already terminated the process
      }
    }
  }

  /**
   * Test server by ID (looks up config from settings)
   */
  async testServerById(serverId: string): Promise<MCPTestResult> {
    try {
      const globalSettings = await this.settingsService.getGlobalSettings();
      const serverConfig = globalSettings.mcpServers?.find((s) => s.id === serverId);

      if (!serverConfig) {
        return {
          success: false,
          error: `Server with ID "${serverId}" not found`,
        };
      }

      return this.testServer(serverConfig);
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
      };
    }
  }

  /**
   * Create appropriate transport based on server type
   */
  private async createTransport(
    config: MCPServerConfig
  ): Promise<StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport> {
    if (config.type === 'sse') {
      if (!config.url) {
        throw new Error('URL is required for SSE transport');
      }
      // Use eventSourceInit workaround for SSE headers (SDK bug workaround)
      // See: https://github.com/modelcontextprotocol/typescript-sdk/issues/436
      const headers = config.headers;
      return new SSEClientTransport(new URL(config.url), {
        requestInit: headers ? { headers } : undefined,
        eventSourceInit: headers
          ? {
              fetch: (url: string | URL | Request, init?: RequestInit) => {
                const fetchHeaders = new Headers(init?.headers || {});
                for (const [key, value] of Object.entries(headers)) {
                  fetchHeaders.set(key, value);
                }
                return fetch(url, { ...init, headers: fetchHeaders });
              },
            }
          : undefined,
      });
    }

    if (config.type === 'http') {
      if (!config.url) {
        throw new Error('URL is required for HTTP transport');
      }
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers
          ? {
              headers: config.headers,
            }
          : undefined,
      });
    }

    // Default to stdio
    if (!config.command) {
      throw new Error('Command is required for stdio transport');
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      // Discovery returns structured diagnostics; never inherit arbitrary server stderr.
      stderr: 'ignore',
    });
  }

  /**
   * Create a timeout promise
   */
  private async withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), this.requestTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Extract error message from unknown error
   */
  private getErrorMessage(error: unknown, config?: MCPServerConfig): string {
    let message = error instanceof Error ? error.message : String(error);
    const secrets = [...Object.values(config?.env ?? {}), ...Object.values(config?.headers ?? {})];
    if (config?.url) {
      try {
        const url = new URL(config.url);
        secrets.push(url.username, url.password);
        url.searchParams.forEach((value) => secrets.push(value));
      } catch {
        /* Invalid URLs are reported without echoing configuration. */
      }
      secrets.push(config.url);
    }
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      message = message.split(secret).join('[REDACTED]');
    }
    return message.slice(0, 2048);
  }
}
