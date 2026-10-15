import { Ajv, type ValidateFunction } from 'ajv';
import path from 'node:path';
import {
  type ExecuteOptions,
  type InstallationStatus,
  type ModelDefinition,
  type ProviderMessage,
} from '@automaker/types';
import { BaseProvider } from './base-provider.js';
import { OpenAICompatibleError } from './openai-compatible/errors.js';
import { parseOpenAICompatibleEndpoint } from './openai-compatible/config.js';
import type { ChatCompletionRequest, ChatMessage } from './openai-compatible/transport.js';
import { AgentLoop, agentLimits } from './openai-compatible/agent-loop.js';
import { AgentLimitError, abortable } from './openai-compatible/runtime.js';
import { ToolRegistry, READ_TOOL_NAMES, toolPolicy } from './openai-compatible/tool-registry.js';
import { ReadOnlyWorkspace } from './openai-compatible/workspace.js';

function textContent(value: ExecuteOptions['prompt']): string {
  if (typeof value === 'string') return value;
  if (
    !Array.isArray(value) ||
    value.some((block) => block.type !== 'text' || typeof block.text !== 'string')
  ) {
    throw new OpenAICompatibleError(
      'Only text input is implemented; image/content blocks are not supported yet.'
    );
  }
  return value.map((block) => block.text).join('\n');
}

function outputValidator(options: ExecuteOptions): ValidateFunction | undefined {
  if (!options.outputFormat) return undefined;
  try {
    const schema = options.outputFormat.schema;
    if (options.outputFormat.type !== 'json_schema' || schema.type !== 'object' || schema.$async) {
      throw new Error('Invalid schema');
    }
    // Compile locally before any request. No remote $ref resolution, coercion or mutations.
    return new Ajv({ strict: true, ownProperties: true, logger: false }).compile(schema);
  } catch {
    throw new OpenAICompatibleError('Invalid or unsupported structured output JSON Schema.');
  }
}

/**
 * Direct agent runtime. Mutating tools require a server-granted workspace-write profile.
 * Shell requires a pinned local Docker image; there is no host-shell fallback.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  getName(): string {
    return 'openai-compatible';
  }

  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    try {
      if (options.abortController?.signal.aborted)
        throw new OpenAICompatibleError('Request cancelled.');
      const connection = options.openaiCompatibleConnection;
      if (!connection)
        throw new OpenAICompatibleError('A server-resolved endpoint connection is required.');
      // Revalidate the server-only boundary, including opaque model identity and capabilities.
      const endpoint = parseOpenAICompatibleEndpoint({
        id: connection.endpointId,
        name: 'Resolved endpoint',
        enabled: true,
        baseUrl: connection.baseUrl,
        protocol: connection.protocol,
        auth: { type: 'none' },
        models: [connection.model],
        timeoutMs: connection.timeoutMs,
        maxRetries: connection.maxRetries,
      });
      if (options.model !== connection.model.id) {
        throw new OpenAICompatibleError(
          'Requested model does not match the resolved endpoint model.'
        );
      }
      if (connection.protocol !== 'chat-completions')
        throw new OpenAICompatibleError('Responses transport is not implemented yet.');
      const policy = toolPolicy(options.openaiCompatibleAgent, options.readOnly);
      const available = [
        ...READ_TOOL_NAMES,
        'TodoWrite',
        ...(policy.access === 'workspace-write' ? ['Write', 'Edit'] : []),
        ...(policy.shell ? [policy.shell.executable === 'pwsh' ? 'PowerShell' : 'Bash'] : []),
      ];
      const names =
        options.tools ?? (policy.access === 'workspace-write' ? available : READ_TOOL_NAMES);
      if (!Array.isArray(names) || names.some((name) => !available.includes(name)))
        throw new OpenAICompatibleError('Requested local tool is unavailable in this mode.');
      if (names.length && !connection.model.capabilities.tools)
        throw new OpenAICompatibleError(
          'Tool calling is not enabled for this model; use tools: [] for text generation.'
        );
      if (
        Object.keys(options.mcpServers ?? {}).length ||
        Object.keys(options.agents ?? {}).length
      ) {
        throw new OpenAICompatibleError('MCP tools and subagents are not implemented yet.');
      }
      if (options.sdkSessionId)
        throw new OpenAICompatibleError(
          'Session resume is not implemented yet; provide explicit conversation history.'
        );
      if (options.reasoningEffort && options.reasoningEffort !== 'none') {
        throw new OpenAICompatibleError('Reasoning parameters are not implemented yet.');
      }
      if (options.outputFormat && !connection.model.capabilities.structuredOutput) {
        throw new OpenAICompatibleError('Structured output is not enabled for this model.');
      }
      if (options.systemPrompt && typeof options.systemPrompt !== 'string') {
        throw new OpenAICompatibleError(
          'System prompt presets are not implemented; provide an explicit text prompt.'
        );
      }
      const validate = outputValidator(options);
      const limits = agentLimits(options.openaiCompatibleAgent?.limits, options.maxTurns);
      const messages: ChatMessage[] = [];
      if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
      for (const message of options.conversationHistory ?? []) {
        if (message.role !== 'user' && message.role !== 'assistant') {
          throw new OpenAICompatibleError('Unsupported conversation history role.');
        }
        messages.push({ role: message.role, content: textContent(message.content) });
      }
      messages.push({ role: 'user', content: textContent(options.prompt) });
      let workspace: ReadOnlyWorkspace | undefined;
      let registry: ToolRegistry | undefined;
      if (names.length) {
        const timeoutSignal = AbortSignal.timeout(
          Math.min(limits.toolTimeoutMs, limits.maxDurationMs)
        );
        const signal = options.abortController
          ? AbortSignal.any([timeoutSignal, options.abortController.signal])
          : timeoutSignal;
        workspace = await abortable(ReadOnlyWorkspace.create(options.cwd, signal), signal);
        registry = new ToolRegistry(
          workspace,
          [...new Set(names)],
          options.readOnly ?? false,
          policy
        );
      }
      const request: ChatCompletionRequest = {
        messages,
        stream: endpoint.models[0].capabilities.streaming,
        tools: registry?.definitions() ?? [],
        ...(options.outputFormat && {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'automaker_output',
              schema: options.outputFormat.schema,
              strict: true,
            },
          },
        }),
      };
      yield* new AgentLoop({
        connection: { ...connection, baseUrl: endpoint.baseUrl, model: endpoint.models[0] },
        request,
        workspace: workspace?.root ?? path.resolve(options.cwd),
        registry,
        policy,
        signal: options.abortController?.signal,
        maxTurns: options.maxTurns,
        agent: options.openaiCompatibleAgent,
        validateOutput: validate,
      }).run();
    } catch (error) {
      const message =
        error instanceof OpenAICompatibleError
          ? error.message
          : 'OpenAI-compatible: Invalid configuration or request.';
      yield { type: 'error', error: message };
      yield {
        type: 'result',
        subtype: error instanceof AgentLimitError ? error.subtype : 'error_during_execution',
        error: message,
      };
    }
  }

  async detectInstallation(): Promise<InstallationStatus> {
    // Runtime availability is not endpoint authentication or a successful connectivity probe.
    return { installed: true, authenticated: false, hasApiKey: false, method: 'sdk' };
  }

  getAvailableModels(): ModelDefinition[] {
    // Endpoint-scoped catalogs will be integrated with SettingsService in stage 5.
    return [];
  }

  supportsFeature(feature: string): boolean {
    return (
      feature === 'text' ||
      feature === 'streaming' ||
      (feature === 'tools' && process.platform === 'linux')
    );
  }
}
