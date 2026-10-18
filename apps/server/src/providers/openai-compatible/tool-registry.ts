import { Ajv, type ValidateFunction } from 'ajv';
import type { ChatToolCall, ChatToolDefinition } from './transport.js';
import { ReadOnlyWorkspace } from './workspace.js';
import { createReadTools } from './read-tools.js';
import type { LocalTool } from './local-tool.js';
import { checkAbort, ToolError } from './runtime.js';
import { OpenAICompatibleError } from './errors.js';
import type { DirectAgentOptions } from '@automaker/types';
import { createTodoTool, createWriteTools } from './write-tools.js';
import { createShellTool } from './shell-tool.js';
import {
  isIssuedEnvironment,
  type ExecutionEnvironment,
} from '../../services/execution-environment/runtime.js';
import { createEnvironmentTools } from './environment-tools.js';

const MAX_OUTPUT_CHARS = 16_384;
export const READ_TOOL_NAMES = ['Read', 'LS', 'Glob', 'Grep'];

export function toolPolicy(
  agent: DirectAgentOptions | undefined,
  readOnly = false
): {
  access: 'read-only' | 'workspace-write';
  shell?: DirectAgentOptions['shell'];
} {
  const requested = agent?.access ?? 'read-only';
  if (!['read-only', 'workspace-write', 'full-access'].includes(requested))
    throw new OpenAICompatibleError('Invalid local agent access profile.');
  if (requested === 'full-access')
    throw new OpenAICompatibleError(
      'full-access is intentionally unavailable; use a sandboxed workspace-write profile.'
    );
  const access = readOnly ? 'read-only' : requested;
  const shell = agent?.shell;
  if (
    shell !== undefined &&
    (!shell ||
      shell.backend !== 'docker' ||
      !/^sha256:[a-f0-9]{64}$/.test(shell.image) ||
      !['sh', 'bash', 'pwsh'].includes(shell.executable ?? 'sh') ||
      Object.keys(shell).some((key) => !['backend', 'image', 'executable'].includes(key)))
  )
    throw new OpenAICompatibleError(
      'Shell requires a trusted Docker image pinned by its full sha256 ID and a supported executable.'
    );
  // Detached policy values cannot change while a query is running.
  return { access, ...(shell && { shell: { ...shell } }) };
}

export class ToolRegistry {
  private readonly tools = new Map<string, { tool: LocalTool; validate: ValidateFunction }>();

  constructor(
    workspace: ReadOnlyWorkspace | ExecutionEnvironment,
    names: string[],
    readOnly: boolean,
    agent?: DirectAgentOptions
  ) {
    const environment = isIssuedEnvironment(workspace) ? workspace : undefined;
    const policy = toolPolicy(agent, readOnly);
    const ajv = new Ajv({ strict: true, ownProperties: true, logger: false });
    const available = environment
      ? [...createEnvironmentTools(environment, readOnly), createTodoTool()]
      : [
          ...createReadTools(workspace as ReadOnlyWorkspace),
          createTodoTool(),
          ...(policy.access === 'workspace-write'
            ? createWriteTools(workspace as ReadOnlyWorkspace)
            : []),
          ...(policy.shell
            ? [
                createShellTool(
                  workspace as ReadOnlyWorkspace,
                  policy.shell,
                  policy.access === 'workspace-write'
                ),
              ]
            : []),
        ];
    for (const tool of available) {
      if (names.includes(tool.definition.function.name)) {
        this.tools.set(tool.definition.function.name, {
          tool,
          validate: ajv.compile(tool.definition.function.parameters),
        });
      }
    }
    if (names.some((name) => !this.tools.has(name)))
      throw new OpenAICompatibleError('Requested local tool is unavailable in this mode.');
  }

  definitions(): ChatToolDefinition[] {
    return [...this.tools.values()].map(({ tool }) => tool.definition);
  }

  mustDrain(call: ChatToolCall): boolean {
    const effect = this.tools.get(call.function.name)?.tool.effect;
    return effect === 'write' || effect === 'shell';
  }

  async execute(
    call: ChatToolCall,
    signal: AbortSignal
  ): Promise<{ input: unknown; content: string }> {
    checkAbort(signal);
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      return {
        input: null,
        content: JSON.stringify({
          ok: false,
          error: {
            code: 'INVALID_ARGUMENTS',
            message: 'Arguments must be a JSON object matching the tool schema.',
          },
        }),
      };
    }
    const entry = this.tools.get(call.function.name);
    let result: unknown;
    try {
      if (!entry) throw new ToolError('UNKNOWN_TOOL', 'This tool is not available.');
      if (!entry.validate(input))
        throw new ToolError(
          'INVALID_ARGUMENTS',
          'Arguments must match the tool schema; no type coercion is performed.'
        );
      result = {
        ok: true,
        result: await entry.tool.execute(input as Record<string, unknown>, signal),
      };
    } catch (error) {
      // A cancelled run must still tell the operator if its sandbox may be alive.
      if (
        error instanceof ToolError &&
        (['SANDBOX_CLEANUP_FAILED', 'PROCESS_CLEANUP_FAILED'].includes(error.code) ||
          error.code.startsWith('SSH_'))
      )
        throw new OpenAICompatibleError(error.message);
      checkAbort(signal);
      if (error instanceof OpenAICompatibleError) throw error;
      result = {
        ok: false,
        error: {
          code: error instanceof ToolError ? error.code : 'TOOL_FAILED',
          message: error instanceof ToolError ? error.message : 'Tool execution failed.',
        },
      };
    }
    checkAbort(signal);
    const serialized = JSON.stringify(result);
    return {
      input,
      content:
        serialized.length <= MAX_OUTPUT_CHARS
          ? serialized
          : JSON.stringify({
              ok: true,
              truncated: true,
              output: serialized.slice(0, Math.floor((MAX_OUTPUT_CHARS - 256) / 2)),
            }),
    };
  }
}
