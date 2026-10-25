/** Saved-server MCP discovery; no tools are executed and no server installation occurs. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPServerConfig, MCPToolInfo } from '@automaker/types';
import type { SettingsService } from './settings-service.js';
import type { OwnedLocalChildRuntime } from '../core/platform/owned-local-child.runtime.js';
import { MCPBoundedFetch } from './mcp/bounded-fetch.js';
import { MCPBoundedStdioTransport } from './mcp/bounded-stdio-transport.js';
import { bounded, MCPCleanupError, MCPOperationError, MCPByteBudget } from './mcp/operation.js';
import {
  unobservedOperation,
  type ObserveOperation,
} from '../core/observability/operation-observer.js';

export interface MCPTestResult {
  success: boolean;
  tools?: MCPToolInfo[];
  error?: string;
  connectionTime?: number;
  serverInfo?: { name?: string; version?: string };
}
export interface MCPRuntimeOptions {
  observeOperation?: ObserveOperation;
  environment?: Readonly<NodeJS.ProcessEnv>;
  workingDirectory?: string;
  childRuntime?: OwnedLocalChildRuntime;
}
interface Operation {
  controller: AbortController;
  task: Promise<MCPTestResult>;
  unknown: boolean;
  client?: Client;
  transport?: Transport;
  network?: MCPBoundedFetch;
  cleanup?: Promise<void>;
}
export class MCPTestService {
  private readonly observeOperation: ObserveOperation;
  private readonly environment: Readonly<NodeJS.ProcessEnv>;
  private readonly cwd: string;
  private readonly operations = new Set<Operation>();
  private stopping = false;
  private shutdown?: Promise<void>;
  constructor(
    private readonly settingsService: SettingsService,
    private readonly requestTimeoutMs = 10000,
    private readonly runtime: MCPRuntimeOptions = {}
  ) {
    this.observeOperation = runtime.observeOperation ?? unobservedOperation;
    this.environment = Object.freeze({ ...(runtime.environment ?? process.env) });
    this.cwd = runtime.workingDirectory ?? process.cwd();
  }
  get activeOperationCount(): number {
    return this.operations.size;
  }
  get unconfirmedOperationCount(): number {
    return [...this.operations].filter((operation) => operation.unknown).length;
  }
  testServer(config: MCPServerConfig): Promise<MCPTestResult> {
    const snapshot = globalThis.structuredClone(config);
    return this.admit(async () => snapshot, true);
  }
  testConnectionById(id: string): Promise<MCPTestResult> {
    return this.saved(id, false);
  }
  listToolsById(id: string): Promise<MCPTestResult> {
    return this.saved(id, true);
  }
  testServerById(id: string): Promise<MCPTestResult> {
    return this.saved(id, true);
  }
  private saved(id: string, discover: boolean): Promise<MCPTestResult> {
    return this.admit(async () => {
      const settings = await this.settingsService.getGlobalSettings();
      const config = settings.mcpServers?.find((server) => server.id === id);
      if (!config) throw new MCPOperationError(`Server with ID "${id.slice(0, 256)}" not found`);
      return globalThis.structuredClone(config);
    }, discover);
  }
  private admit(
    resolve: () => Promise<MCPServerConfig>,
    discover: boolean
  ): Promise<MCPTestResult> {
    const error = this.stopping
      ? 'MCP discovery is shutting down'
      : [...this.operations].some((operation) => operation.unknown)
        ? 'MCP cleanup is unconfirmed. Inspect owned resources before retrying.'
        : this.operations.size >= 16
          ? 'MCP discovery admission limit reached'
          : undefined;
    if (error) return Promise.resolve({ success: false, error });
    const operation = { controller: new AbortController(), unknown: false } as Operation;
    this.operations.add(operation);
    operation.task = Promise.resolve()
      .then(() =>
        this.observeOperation(
          'mcp_inspection',
          () => this.inspect(operation, resolve, discover),
          undefined,
          operation.controller.signal,
          (result) =>
            operation.unknown
              ? 'unknown'
              : result.success
                ? 'completed'
                : this.stopping && operation.controller.signal.aborted
                  ? 'cancelled'
                  : 'error'
        )
      )
      .finally(() => {
        if (!operation.unknown) this.operations.delete(operation);
      });
    return operation.task;
  }
  private async inspect(
    operation: Operation,
    resolve: () => Promise<MCPServerConfig>,
    discover: boolean
  ): Promise<MCPTestResult> {
    const start = Date.now();
    let config: MCPServerConfig | undefined, result: MCPTestResult;
    try {
      config = await resolve();
      this.check(operation);
      const budget = new MCPByteBudget();
      const client = (operation.client = new Client({
        name: 'automaker-mcp-test',
        version: '1.0.0',
      }));
      operation.transport = this.transport(config, operation, budget);
      this.check(operation);
      await this.phase(client.connect(operation.transport), operation, 'Connection timeout');
      this.check(operation);
      const tools = discover
        ? await this.phase(client.listTools(), operation, 'List tools timeout')
        : undefined;
      this.check(operation);
      if (
        tools &&
        (tools.tools.length > 1000 || Buffer.byteLength(JSON.stringify(tools)) > 1024 * 1024)
      )
        throw new MCPOperationError('MCP tool catalog exceeds the allowed size');
      result = {
        success: true,
        ...(tools && {
          tools: tools.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            enabled: true,
          })),
        }),
        connectionTime: Date.now() - start,
        serverInfo: {
          name: client.getServerVersion()?.name ?? config.name,
          version: client.getServerVersion()?.version,
        },
      };
    } catch (error) {
      result = {
        success: false,
        error: this.message(error, config, operation),
        connectionTime: Date.now() - start,
      };
    }
    try {
      await this.cleanup(operation);
    } catch {
      operation.unknown = true;
      result = {
        success: false,
        error: new MCPCleanupError().message,
        connectionTime: Date.now() - start,
      };
    }
    return result;
  }
  private check(operation: Operation): void {
    if (this.stopping && !operation.controller.signal.aborted)
      operation.controller.abort(new MCPOperationError('MCP discovery is shutting down'));
    operation.controller.signal.throwIfAborted();
  }
  private async phase<T>(promise: Promise<T>, operation: Operation, message: string): Promise<T> {
    const signal = operation.controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason ?? new MCPOperationError('MCP operation cancelled'));
          signal.addEventListener('abort', onAbort, { once: true });
          timer = setTimeout(
            () => operation.controller.abort(new MCPOperationError(message)),
            this.requestTimeoutMs
          );
          if (signal.aborted) onAbort();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
  private transport(
    config: MCPServerConfig,
    operation: Operation,
    budget: MCPByteBudget
  ): Transport {
    if (config.type === 'http' || config.type === 'sse') {
      if (!config.url)
        throw new MCPOperationError(
          `URL is required for ${config.type === 'http' ? 'HTTP' : 'SSE'} transport`
        );
      const network = (operation.network = new MCPBoundedFetch(operation.controller, budget));
      const options = {
        fetch: network.fetch,
        requestInit: config.headers ? { headers: config.headers } : undefined,
      };
      return config.type === 'http'
        ? new StreamableHTTPClientTransport(new URL(config.url), options)
        : new SSEClientTransport(new URL(config.url), {
            ...options,
            eventSourceInit: { fetch: network.fetch },
          });
    }
    if (!config.command) throw new MCPOperationError('Command is required for stdio transport');
    return new MCPBoundedStdioTransport(
      config,
      this.environment,
      this.cwd,
      operation.controller,
      budget,
      this.runtime.childRuntime
    );
  }
  private cleanup(operation: Operation): Promise<void> {
    return (operation.cleanup ??= bounded(
      (async () => {
        operation.controller.abort(new MCPOperationError('MCP operation cancelled'));
        const results = await Promise.allSettled([
          operation.client?.close(),
          operation.transport?.close(),
          operation.network?.close(),
        ]);
        if (results.some((result) => result.status === 'rejected')) throw new MCPCleanupError();
      })(),
      5000,
      new MCPCleanupError()
    ).catch((error) => {
      operation.unknown = true;
      throw error;
    }));
  }
  /** Drain accepted settings/transport work before the shared filesystem barrier. */
  onModuleDestroy(): Promise<void> {
    return this.beforeApplicationShutdown();
  }
  beforeApplicationShutdown(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    for (const operation of this.operations)
      operation.controller.abort(new MCPOperationError('MCP discovery is shutting down'));
    const accepted = [...this.operations];
    return (this.shutdown = bounded(
      Promise.all(accepted.map((operation) => operation.task)).then(() => {
        if (accepted.some((operation) => operation.unknown)) throw new MCPCleanupError();
      }),
      5000,
      new MCPCleanupError()
    ).catch((error) => {
      for (const operation of accepted) operation.unknown = true;
      throw error;
    }));
  }
  private message(
    error: unknown,
    config: MCPServerConfig | undefined,
    operation: Operation
  ): string {
    const reason = operation.controller.signal.reason;
    if (error instanceof MCPOperationError) return error.message;
    if (reason instanceof MCPOperationError) return reason.message;
    // Remote SDK/HTTP text may contain secrets not represented by named credential fields.
    // Return a fixed diagnostic; retain the historical explicit redaction marker when matched.
    const raw = error instanceof Error ? error.message : String(error);
    const secrets = [...Object.values(config?.env ?? {}), ...Object.values(config?.headers ?? {})];
    if (config?.url) {
      secrets.push(config.url);
      try {
        const url = new URL(config.url);
        secrets.push(url.username, url.password);
        url.searchParams.forEach((value) => secrets.push(value));
      } catch {
        /* Never echo invalid URL. */
      }
    }
    return `MCP connection or discovery failed${secrets.some((secret) => secret && raw.includes(secret)) ? ' ([REDACTED])' : ''}`;
  }
}
