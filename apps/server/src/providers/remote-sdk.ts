import type { ExecuteOptions, ProviderMessage, RemoteSdkProvider } from '@automaker/types';
import {
  calculateReasoningTimeout,
  getThinkingTokenBudget,
  modelTimeout,
  MAX_MODEL_TIMEOUT_MS,
} from '@automaker/types';
import { ExecutionEnvironmentError } from '../services/execution-environment/runtime.js';
import { providerManifest } from '../services/execution-environment/provider-catalog.js';
import { remoteCliRuntime } from './environment-execution.js';
import { environmentJSONL } from './environment-jsonl.js';
import { REMOTE_SDK_WORKER } from './remote-sdk-worker.js';
import {
  resolveCodexToolCall,
  extractCodexTodoItems,
  getCodexTodoToolName,
} from './codex-tool-mapping.js';

export async function* executeRemoteSdk(
  provider: RemoteSdkProvider,
  options: ExecuteOptions,
  normalize?: (event: unknown) => ProviderMessage | null
): AsyncGenerator<ProviderMessage> {
  const runtime = remoteCliRuntime(options);
  if (!runtime)
    throw new ExecutionEnvironmentError(
      'INVALID_RUNTIME',
      'Remote SDK execution requires a server-issued Docker/SSH runtime.'
    );
  if (
    Object.keys(options.mcpServers ?? {}).length ||
    options.agents ||
    options.claudeApiProfile ||
    options.claudeCompatibleProvider
  )
    throw new ExecutionEnvironmentError(
      'REMOTE_PROVIDER_CONFIG_UNSUPPORTED',
      'Controller MCP/subagents/connection profiles are not forwarded to remote SDKs.'
    );
  if (
    (options.readOnly && provider === 'copilot') ||
    (options.tools !== undefined && provider !== 'claude')
  )
    throw new ExecutionEnvironmentError(
      'REMOTE_PROVIDER_READ_ONLY_UNSUPPORTED',
      'This SDK cannot enforce the requested remote tool restrictions yet.'
    );
  if (Array.isArray(options.prompt) && options.prompt.some((part) => part.type !== 'text'))
    throw new ExecutionEnvironmentError(
      'REMOTE_PROVIDER_INPUT_UNSUPPORTED',
      'Remote SDK attachments are not integrated yet.'
    );
  if (
    (provider === 'copilot' && options.outputFormat) ||
    options.codexSettings?.additionalDirs?.length ||
    (provider === 'codex' &&
      options.codexSettings?.approvalPolicy &&
      options.codexSettings.approvalPolicy !== 'never')
  )
    throw new ExecutionEnvironmentError(
      'REMOTE_PROVIDER_CONFIG_UNSUPPORTED',
      'Remote SDK cannot honor the requested output schema, additional directories or interactive approvals.'
    );
  const prompt =
    typeof options.prompt === 'string'
      ? options.prompt
      : options.prompt.map((part) => part.text ?? '').join('\n');
  const sdkOptions = {
    prompt,
    sandboxed: runtime.type === 'docker',
    model:
      provider === 'copilot' ? options.model.replace(/-(\d+)-(\d+)$/, '-$1.$2') : options.model,
    systemPrompt:
      typeof options.systemPrompt === 'object' ? options.systemPrompt.append : options.systemPrompt,
    maxTurns: options.maxTurns,
    readOnly: options.readOnly,
    tools: options.tools,
    allowedTools: options.allowedTools,
    sdkSessionId: options.sdkSessionId,
    outputFormat: options.outputFormat,
    maxThinkingTokens:
      options.thinkingLevel === 'adaptive'
        ? undefined
        : getThinkingTokenBudget(options.thinkingLevel),
    reasoningEffort: options.reasoningEffort === 'none' ? undefined : options.reasoningEffort,
    codexSettings: options.codexSettings
      ? {
          sandboxMode: options.codexSettings.sandboxMode,
          enableWebSearch: options.codexSettings.enableWebSearch,
        }
      : undefined,
    requestTimeoutMs: options.modelTimeouts?.requestTimeoutMs,
  };
  let completed = false,
    result: ProviderMessage | undefined,
    sessionId: string | undefined;
  const tools = new Map<string, string>();
  for await (const raw of environmentJSONL(
    runtime,
    {
      command: 'node',
      args: ['-e', REMOTE_SDK_WORKER],
      cwd: runtime.cwd,
      stdinData: JSON.stringify({ manifest: providerManifest(provider), options: sdkOptions }),
      abortController: options.abortController,
      timeout: Math.min(
        MAX_MODEL_TIMEOUT_MS,
        calculateReasoningTimeout(
          options.reasoningEffort,
          modelTimeout(options.modelTimeouts, 'cliIdleTimeoutMs')
        )
      ),
    },
    modelTimeout(options.modelTimeouts, 'remoteProcessTimeoutMs')
  )) {
    const frame = raw as {
      kind: string;
      event?: Record<string, unknown>;
      sessionId?: string;
      code?: string;
      message?: string;
    };
    if (frame.kind === 'heartbeat') continue;
    if (frame.kind === 'failure')
      throw new ExecutionEnvironmentError(
        frame.code ?? 'REMOTE_SDK_FAILED',
        frame.message ?? 'Remote SDK failed.'
      );
    if (frame.kind === 'complete') {
      completed = true;
      continue;
    }
    if (frame.kind !== 'event' || !frame.event || completed)
      throw new ExecutionEnvironmentError(
        'REMOTE_SDK_PROTOCOL',
        'Invalid target SDK event stream.'
      );
    sessionId = frame.sessionId ?? sessionId;
    const event = frame.event;
    let message: ProviderMessage | null = null;
    if (provider === 'claude') message = event as unknown as ProviderMessage;
    else if (provider === 'copilot') message = normalize?.(event) ?? null;
    else {
      if (event.type === 'thread.started') sessionId = event.thread_id as string;
      if (event.type === 'turn.failed' || event.type === 'error')
        throw new ExecutionEnvironmentError(
          'REMOTE_SDK_FAILED',
          String(
            (event.error as { message?: string })?.message ??
              event.message ??
              'Remote Codex turn failed.'
          )
        );
      if (event.type === 'turn.completed') message = { type: 'result', subtype: 'success' };
      const item = event.item as Record<string, unknown> | undefined;
      if (item) {
        const id = String(item.id ?? '');
        if (event.type === 'item.started' && item.type === 'command_execution') {
          const tool = resolveCodexToolCall(String(item.command ?? ''));
          tools.set(id, `codex-${id}`);
          message = {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: tool.name,
                  input: tool.input,
                  tool_use_id: `codex-${id}`,
                },
              ],
            },
          };
        } else if (event.type === 'item.completed' && item.type === 'command_execution') {
          message = {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: tools.get(id),
                  content: String(item.aggregated_output ?? ''),
                },
              ],
            },
          };
          tools.delete(id);
        } else if (
          event.type === 'item.completed' &&
          ['agent_message', 'reasoning'].includes(String(item.type))
        ) {
          message = {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                item.type === 'reasoning'
                  ? { type: 'thinking', thinking: String(item.text ?? '') }
                  : { type: 'text', text: String(item.text ?? '') },
              ],
            },
          };
        } else if (item.type === 'todo_list') {
          const todos = extractCodexTodoItems(item);
          if (todos)
            message = {
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [{ type: 'tool_use', name: getCodexTodoToolName(), input: { todos } }],
              },
            };
        }
      }
    }
    if (!message) continue;
    message.session_id ??= sessionId;
    if (
      message.type === 'error' ||
      (message.type === 'result' && (event.is_error || message.subtype?.startsWith('error')))
    )
      throw new ExecutionEnvironmentError(
        'REMOTE_SDK_FAILED',
        message.error ?? 'Remote SDK reported an unsuccessful result.'
      );
    if (message.type === 'result') result = message;
    else yield message;
  }
  if (!completed || !result)
    throw new ExecutionEnvironmentError(
      'REMOTE_SDK_INCOMPLETE',
      'Remote SDK did not confirm completion. Inspect prior effects before resuming.'
    );
  yield result;
}
