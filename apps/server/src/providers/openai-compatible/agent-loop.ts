import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { ValidateFunction } from 'ajv';
import type {
  DirectAgentCheckpoint,
  DirectAgentLimits,
  DirectAgentOptions,
  ProviderMessage,
  ResolvedOpenAICompatibleConnection,
} from '@automaker/types';
import {
  chatCompletion,
  type ChatCompletion,
  type ChatCompletionRequest,
  type ChatMessage,
  type ChatToolCall,
} from './transport.js';
import { parseCheckpoint } from './checkpoint.js';
import { OpenAICompatibleError } from './errors.js';
import { abortable, AgentLimitError, checkAbort } from './runtime.js';
import { ToolRegistry } from './tool-registry.js';

export const DEFAULT_AGENT_LIMITS: Required<DirectAgentLimits> = {
  maxToolCalls: 64,
  maxDurationMs: 300_000,
  toolTimeoutMs: 10_000,
  maxContextBytes: 1024 * 1024,
  maxOutputChars: 262_144,
  maxRepeatedCalls: 3,
};
const MAX_LIMITS: Required<DirectAgentLimits> = {
  maxToolCalls: 256,
  maxDurationMs: 3_600_000,
  toolTimeoutMs: 60_000,
  maxContextBytes: 4 * 1024 * 1024,
  maxOutputChars: 1024 * 1024,
  maxRepeatedCalls: 10,
};

export function agentLimits(input: DirectAgentLimits | undefined, maxTurns: number | undefined) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
    throw new OpenAICompatibleError('Invalid agent limits.');
  const limits = { ...DEFAULT_AGENT_LIMITS, ...input };
  if (Object.keys(input ?? {}).some((key) => !Object.hasOwn(DEFAULT_AGENT_LIMITS, key)))
    throw new OpenAICompatibleError('Unknown agent limit.');
  for (const key of Object.keys(DEFAULT_AGENT_LIMITS) as Array<keyof DirectAgentLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > MAX_LIMITS[key]) {
      throw new OpenAICompatibleError('Invalid agent limit.');
    }
  }
  const turns = maxTurns === undefined ? 12 : maxTurns;
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > 100)
    throw new OpenAICompatibleError('maxTurns must be an integer from 1 to 100.');
  return { ...limits, maxTurns: turns };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function signature(call: ChatToolCall): string {
  try {
    return createHash('sha256')
      .update(call.function.name + ':' + canonical(JSON.parse(call.function.arguments)))
      .digest('hex');
  } catch {
    throw new OpenAICompatibleError('Invalid checkpoint tool arguments.');
  }
}

function interruptedResult(id: string): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: id,
    content: JSON.stringify({
      ok: false,
      error: {
        code: 'INTERRUPTED',
        message:
          'Tool result unavailable because the run was interrupted. Do not assume it succeeded.',
      },
    }),
  };
}

export class AgentLoop {
  constructor(
    private readonly options: {
      connection: ResolvedOpenAICompatibleConnection;
      request: ChatCompletionRequest;
      workspace: string;
      registry?: ToolRegistry;
      policy?: unknown;
      signal?: AbortSignal;
      maxTurns?: number;
      agent?: DirectAgentOptions;
      validateOutput?: ValidateFunction;
    }
  ) {}

  async *run(): AsyncGenerator<ProviderMessage> {
    const { connection, request, registry, agent, validateOutput } = this.options;
    const limits = agentLimits(agent?.limits, this.options.maxTurns);
    const requestHash = createHash('sha256')
      .update(
        canonical({
          baseUrl: connection.baseUrl,
          protocol: connection.protocol,
          policy: this.options.policy ?? null,
          request,
        })
      )
      .digest('hex');
    const initialMessages = JSON.parse(JSON.stringify(request.messages)) as ChatMessage[];
    const state: DirectAgentCheckpoint = agent?.checkpoint
      ? parseCheckpoint(agent.checkpoint)
      : {
          version: 1,
          sessionId: randomUUID(),
          endpointId: connection.endpointId,
          modelId: connection.model.id,
          workspace: this.options.workspace,
          requestHash,
          tools: (request.tools ?? []).map((tool) => tool.function.name).sort(),
          status: 'running',
          turns: 0,
          toolCalls: 0,
          outputChars: 0,
          elapsedMs: 0,
          messages: initialMessages,
        };
    parseCheckpoint(state);
    if (
      state.endpointId !== connection.endpointId ||
      state.modelId !== connection.model.id ||
      state.workspace !== this.options.workspace ||
      state.requestHash !== requestHash ||
      canonical(state.tools) !==
        canonical((request.tools ?? []).map((tool) => tool.function.name).sort()) ||
      canonical(state.messages.slice(0, initialMessages.length)) !== canonical(initialMessages)
    ) {
      throw new OpenAICompatibleError(
        'Checkpoint does not match this endpoint, workspace, tools or request.'
      );
    }
    if (state.status === 'completed')
      throw new OpenAICompatibleError(
        'Checkpoint is already completed. Start a new request instead.'
      );
    const usedIds = new Set<string>();
    const repeats = new Map<string, number>();
    for (const message of state.messages)
      for (const call of message.tool_calls ?? []) {
        usedIds.add(call.id);
        const key = signature(call);
        repeats.set(key, (repeats.get(key) ?? 0) + 1);
      }
    const started = performance.now();
    const previousElapsed = state.elapsedMs;
    if (previousElapsed >= limits.maxDurationMs)
      throw new AgentLimitError('Agent duration budget is exhausted.');
    const controller = new AbortController();
    const signal = this.options.signal
      ? AbortSignal.any([this.options.signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(() => controller.abort(), limits.maxDurationMs - previousElapsed);
    let pending: string[] = [];
    const save = async (final = false, pendingIntent = false) => {
      state.elapsedMs = previousElapsed + Math.floor(performance.now() - started);
      if (!agent?.onCheckpoint) return;
      // Persist balanced "result unknown" tombstones BEFORE executing effects. A crash
      // cannot resume from the previous model turn and silently replay the same tools.
      const snapshot = parseCheckpoint(
        pendingIntent
          ? {
              ...state,
              status: 'interrupted',
              messages: [...state.messages, ...pending.map(interruptedResult)],
            }
          : state
      );
      const checkpointController = new AbortController();
      const checkpointTimer = setTimeout(() => checkpointController.abort(), 1000);
      try {
        await abortable(
          Promise.resolve(agent.onCheckpoint(snapshot)),
          final
            ? checkpointController.signal
            : AbortSignal.any([signal, checkpointController.signal])
        );
      } catch {
        if (!final) checkAbort(signal);
        throw new OpenAICompatibleError('Agent checkpoint could not be saved.');
      } finally {
        clearTimeout(checkpointTimer);
      }
    };
    const contextCheck = (messages = state.messages) => {
      const bytes =
        Buffer.byteLength(JSON.stringify({ ...request, messages }), 'utf8') + messages.length * 32;
      const context = connection.model.contextWindow;
      const reserve =
        connection.model.maxOutputTokens ?? (context ? Math.min(4096, Math.floor(context / 4)) : 0);
      // Deliberately conservative byte guard, not a tokenizer guarantee for arbitrary endpoints.
      const maximum =
        context === undefined
          ? limits.maxContextBytes
          : Math.min(limits.maxContextBytes, Math.max(0, context - reserve));
      if (bytes > maximum)
        throw new AgentLimitError(
          'Agent context budget is exhausted; automatic compaction is not implemented.'
        );
    };
    try {
      while (true) {
        checkAbort(signal);
        if (state.turns >= limits.maxTurns)
          throw new AgentLimitError('Agent maxTurns reached.', 'error_max_turns');
        if (state.outputChars > limits.maxOutputChars || state.toolCalls > limits.maxToolCalls)
          throw new AgentLimitError('Agent output or tool budget is exhausted.');
        contextCheck();
        state.status = 'running';
        state.turns++;
        await save();
        let completion: ChatCompletion | undefined;
        for await (const event of chatCompletion(
          connection,
          { ...request, messages: state.messages },
          signal
        )) {
          if (event.type === 'text') {
            state.outputChars += event.text.length;
            if (state.outputChars > limits.maxOutputChars)
              throw new AgentLimitError('Agent output budget is exhausted.');
            yield {
              type: 'assistant',
              message: { role: 'assistant', content: [{ type: 'text', text: event.text }] },
            };
          } else completion = event.completion;
        }
        checkAbort(signal);
        if (!completion) throw new OpenAICompatibleError('Missing terminal model response.');
        if (completion.finishReason === 'length' || completion.finishReason === 'content_filter') {
          throw new OpenAICompatibleError(
            completion.finishReason === 'length'
              ? 'Model output was truncated by its token limit.'
              : 'Model output was blocked by a content filter.'
          );
        }
        if (completion.finishReason === 'stop') {
          if (state.messages.length >= 1024)
            throw new AgentLimitError('Agent message budget is exhausted.');
          let structuredOutput: Record<string, unknown> | undefined;
          if (validateOutput) {
            try {
              const parsed: unknown = JSON.parse(completion.text);
              if (!validateOutput(parsed)) throw new Error('Invalid schema output');
              structuredOutput = parsed as Record<string, unknown>;
            } catch {
              throw new OpenAICompatibleError(
                'Model output did not match the requested JSON Schema.'
              );
            }
          }
          state.messages.push({ role: 'assistant', content: completion.text });
          state.status = 'completed';
          await save();
          checkAbort(signal);
          clearTimeout(timer);
          yield {
            type: 'result',
            subtype: 'success',
            ...(structuredOutput && { structured_output: structuredOutput }),
          };
          return;
        }
        if (!registry)
          throw new OpenAICompatibleError(
            'The model requested tools, but tools are disabled for this request.'
          );
        if (state.turns >= limits.maxTurns)
          throw new AgentLimitError(
            'Agent maxTurns reached before another tool turn.',
            'error_max_turns'
          );
        if (state.toolCalls + completion.toolCalls.length > limits.maxToolCalls)
          throw new AgentLimitError('Agent tool-call budget is exhausted.');
        if (state.messages.length + completion.toolCalls.length + 1 > 1024)
          throw new AgentLimitError('Agent message budget is exhausted.');
        for (const call of completion.toolCalls) {
          if (usedIds.has(call.id))
            throw new OpenAICompatibleError('Model reused an earlier tool call ID.');
          usedIds.add(call.id);
          const key = signature(call);
          const count = (repeats.get(key) ?? 0) + 1;
          if (count > limits.maxRepeatedCalls)
            throw new AgentLimitError('Repeated identical tool calls exceeded the agent limit.');
          repeats.set(key, count);
        }
        const assistant: ChatMessage = {
          role: 'assistant',
          content: completion.text || null,
          tool_calls: completion.toolCalls,
        };
        contextCheck([...state.messages, assistant]);
        state.messages.push(assistant);
        state.toolCalls += completion.toolCalls.length;
        pending = completion.toolCalls.map((call) => call.id);
        for (const call of completion.toolCalls) {
          checkAbort(signal);
          await save(false, true);
          // Transport already verified JSON syntax. Registry verifies names and JSON Schema.
          const input: unknown = JSON.parse(call.function.arguments);
          yield {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', name: call.function.name, tool_use_id: call.id, input },
              ],
            },
          };
          let result: { input: unknown; content: string };
          try {
            checkAbort(signal);
            const toolController = new AbortController();
            const toolSignal = AbortSignal.any([signal, toolController.signal]);
            const toolTimer = setTimeout(() => toolController.abort(), limits.toolTimeoutMs);
            try {
              // Mutating tools must finish cancellation/cleanup before the run completes.
              const operation = registry.execute(call, toolSignal);
              result = registry.mustDrain(call)
                ? await operation
                : await abortable(operation, toolSignal);
            } finally {
              clearTimeout(toolTimer);
              toolController.abort();
            }
          } catch (error) {
            const interrupted = interruptedResult(call.id);
            state.messages.push(interrupted);
            pending.shift();
            yield {
              type: 'assistant',
              message: {
                role: 'assistant',
                content: [
                  { type: 'tool_result', tool_use_id: call.id, content: interrupted.content ?? '' },
                ],
              },
            };
            throw error;
          }
          state.messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
          pending.shift();
          yield {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'tool_result', tool_use_id: call.id, content: result.content }],
            },
          };
          contextCheck();
        }
        await save();
      }
    } catch (error) {
      state.status = signal.aborted ? 'interrupted' : 'failed';
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (state.status === 'running') state.status = 'interrupted';
      for (const id of pending) state.messages.push(interruptedResult(id));
      if (state.status !== 'completed') await save(true);
    }
  }
}
