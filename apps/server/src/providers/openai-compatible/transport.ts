import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder } from 'node:util';
import type { ReadableStream } from 'node:stream/web';
import type {
  ResolvedOpenAICompatibleConnection,
  DirectAgentMessage,
  DirectAgentToolCall,
} from '@automaker/types';
import { OpenAICompatibleError, protocolError } from './errors.js';
import { normalizeOpenAICompatibleBaseUrl } from './config.js';

export type ChatToolCall = DirectAgentToolCall;

export interface ChatToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export type ChatMessage = DirectAgentMessage;

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  stream: boolean;
  tools?: ChatToolDefinition[];
  response_format?: {
    type: 'json_schema';
    json_schema: { name: string; schema: Record<string, unknown>; strict: true };
  };
}

export interface ChatCompletion {
  text: string;
  toolCalls: ChatToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export type ChatCompletionEvent =
  | { type: 'text'; text: string }
  | { type: 'complete'; completion: ChatCompletion };

// Bound total response bytes, an individual SSE frame, accumulated text and tool arguments.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_CHARS = 1024 * 1024;
const MAX_TOOL_CALLS = 128;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolError();
  return value as Record<string, unknown>;
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return protocolError();
  }
}

/** No partial call leaves this accumulator; the future AgentLoop gets complete calls only. */
class CompletionAccumulator {
  text = '';
  private calls = new Map<number, ChatToolCall>();
  private finishReason: ChatCompletion['finishReason'] | undefined;
  private refused = false;

  accept(value: unknown, streaming: boolean): string {
    const chunk = record(value);
    if (chunk.error !== undefined) protocolError();
    if (!Array.isArray(chunk.choices)) protocolError();
    // Optional usage-only trailer. Never counts as a completed model response.
    if (streaming && chunk.choices.length === 0 && chunk.usage != null) return '';
    if (chunk.choices.length !== 1) protocolError();
    const choice = record(chunk.choices[0]);
    if (choice.index !== 0 || this.finishReason) protocolError();
    const message = record(streaming ? choice.delta : choice.message);
    if (message.role !== undefined && message.role !== 'assistant') protocolError();
    if (!streaming && message.role !== 'assistant') protocolError();
    if (message.function_call != null) {
      throw new OpenAICompatibleError('Legacy function_call responses are not supported.');
    }
    let text = '';
    if (message.content != null) {
      if (typeof message.content !== 'string') protocolError();
      text = message.content;
      this.text += text;
      if (this.text.length > MAX_BODY_BYTES) protocolError();
    }
    if (message.refusal != null) {
      if (typeof message.refusal !== 'string') protocolError();
      this.refused ||= message.refusal.length > 0;
    }
    if (message.tool_calls != null) {
      if (!Array.isArray(message.tool_calls)) protocolError();
      for (const [position, rawCall] of message.tool_calls.entries()) {
        const raw = record(rawCall);
        const index = streaming ? raw.index : position;
        if (
          !Number.isSafeInteger(index) ||
          (index as number) < 0 ||
          (index as number) >= MAX_TOOL_CALLS
        ) {
          protocolError();
        }
        let call = this.calls.get(index as number);
        if (!call) {
          call = { id: '', type: 'function', function: { name: '', arguments: '' } };
          this.calls.set(index as number, call);
        }
        if (raw.type !== undefined && raw.type !== 'function') protocolError();
        if (raw.id !== undefined) {
          if (typeof raw.id !== 'string') protocolError();
          call.id += raw.id;
        }
        if (raw.function !== undefined) {
          const fn = record(raw.function);
          if (fn.name !== undefined) {
            if (typeof fn.name !== 'string') protocolError();
            call.function.name += fn.name;
          }
          if (fn.arguments !== undefined) {
            if (typeof fn.arguments !== 'string') protocolError();
            call.function.arguments += fn.arguments;
          }
        }
        if (
          call.id.length > 1024 ||
          call.function.name.length > 1024 ||
          call.function.arguments.length > MAX_FRAME_CHARS
        ) {
          protocolError();
        }
      }
    }
    if (choice.finish_reason != null) {
      const reason = choice.finish_reason;
      if (!['stop', 'tool_calls', 'length', 'content_filter'].includes(reason as string))
        protocolError();
      this.finishReason = reason as ChatCompletion['finishReason'];
    }
    return text;
  }

  complete(): ChatCompletion {
    if (!this.finishReason) protocolError();
    if (this.refused) throw new OpenAICompatibleError('The model refused the request.');
    const toolCalls = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (this.finishReason === 'tool_calls') {
      if (!toolCalls.length) protocolError();
      const ids = new Set<string>();
      for (const call of toolCalls) {
        if (!call.id || !/^[A-Za-z0-9_-]+$/.test(call.function.name) || ids.has(call.id))
          protocolError();
        ids.add(call.id);
        record(parseJson(call.function.arguments));
      }
    } else if (toolCalls.length && this.finishReason === 'stop') {
      protocolError();
    }
    // Truncated/filtered calls are discarded, never handed to an executor.
    return {
      text: this.text,
      toolCalls: this.finishReason === 'tool_calls' ? toolCalls : [],
      finishReason: this.finishReason,
    };
  }
}

/** Decode UTF-8 incrementally and handle CRLF, CR and LF, including split separators. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let line = '';
  let data: string[] = [];
  let frameSize = 0;
  let afterCR = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) protocolError();
      const decoded = decoder.decode(chunk.value, { stream: true });
      for (const char of decoded) {
        if (afterCR && char === '\n') {
          afterCR = false;
          continue;
        }
        afterCR = char === '\r';
        if (char !== '\r' && char !== '\n') {
          line += char;
          if (++frameSize > MAX_FRAME_CHARS) protocolError();
          continue;
        }
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = [];
          frameSize = 0;
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
        line = '';
      }
    }
    // Reject a truncated UTF-8 sequence. Unterminated SSE events are not dispatched.
    decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  if (!response.body) protocolError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) protocolError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return parseJson(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function retryDelay(response: Response, attempt: number): number | undefined {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    // Do not retry sooner than the endpoint asks. Long waits are surfaced to the caller.
    if (Number.isFinite(ms) && ms >= 0) return ms <= 5000 ? Math.ceil(ms) : undefined;
  }
  return Math.min(250 * 2 ** attempt, 2000);
}

/**
 * Only explicit retryable HTTP statuses are retried, before reading any model output.
 * Network errors/partial responses are ambiguous and are never automatically replayed.
 */
export async function* chatCompletion(
  connection: ResolvedOpenAICompatibleConnection,
  request: ChatCompletionRequest,
  signal?: AbortSignal
): AsyncGenerator<ChatCompletionEvent> {
  if (connection.protocol !== 'chat-completions') {
    throw new OpenAICompatibleError('Responses transport is not implemented yet.');
  }
  const baseUrl = normalizeOpenAICompatibleBaseUrl(connection.baseUrl);
  if (
    !Number.isSafeInteger(connection.timeoutMs) ||
    connection.timeoutMs < 1 ||
    connection.timeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(connection.maxRetries) ||
    connection.maxRetries < 0 ||
    connection.maxRetries > 5
  ) {
    throw new OpenAICompatibleError('Invalid timeout or retry configuration.');
  }
  if (
    connection.apiKey !== undefined &&
    (!connection.apiKey.trim() || /[\x00-\x1f\x7f]/.test(connection.apiKey))
  ) {
    throw new OpenAICompatibleError('Invalid API key.');
  }
  if (request.stream && !connection.model.capabilities.streaming) {
    throw new OpenAICompatibleError('Streaming is not enabled for this model.');
  }
  if (request.tools?.length && !connection.model.capabilities.tools) {
    throw new OpenAICompatibleError('Tool calling is not enabled for this model.');
  }
  if (request.response_format && !connection.model.capabilities.structuredOutput) {
    throw new OpenAICompatibleError('Structured output is not enabled for this model.');
  }
  const payload = JSON.stringify({
    ...request,
    model: connection.model.id,
    ...(connection.model.maxOutputTokens !== undefined && {
      max_completion_tokens: connection.model.maxOutputTokens,
    }),
    // [] is accepted internally but omitted on the wire for endpoints rejecting empty tools.
    tools: request.tools?.length ? request.tools : undefined,
    ...(request.tools?.length && { parallel_tool_calls: false }),
  });
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), connection.timeoutMs);
    const headersTimeout = setTimeout(
      () => controller.abort(),
      Math.min(30_000, connection.timeoutMs)
    );
    let response: Response | undefined;
    let backoff: number | undefined;
    try {
      combinedSignal.throwIfAborted();
      response = await fetch(new URL('chat/completions', baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: request.stream ? 'text/event-stream' : 'application/json',
          ...(connection.apiKey !== undefined && { Authorization: `Bearer ${connection.apiKey}` }),
        },
        body: payload,
        redirect: 'manual',
        signal: combinedSignal,
      });
      clearTimeout(headersTimeout);
      if (RETRYABLE_STATUS.has(response.status) && attempt < connection.maxRetries) {
        backoff = retryDelay(response, attempt);
      }
      if (backoff === undefined) {
        if (!response.ok) {
          throw new OpenAICompatibleError(`Endpoint returned HTTP ${response.status}.`);
        }
        const contentType = response.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase();
        if (contentType !== (request.stream ? 'text/event-stream' : 'application/json')) {
          throw new OpenAICompatibleError('Endpoint returned an unexpected content type.');
        }
        const accumulator = new CompletionAccumulator();
        if (request.stream) {
          if (!response.body) protocolError();
          let done = false;
          for await (const data of sseData(response.body)) {
            if (data === '[DONE]') {
              done = true;
              break;
            }
            const text = accumulator.accept(parseJson(data), true);
            if (text) yield { type: 'text', text };
          }
          if (!done) protocolError();
        } else {
          const text = accumulator.accept(await readJsonBody(response), false);
          if (text) yield { type: 'text', text };
        }
        combinedSignal.throwIfAborted();
        const completion = accumulator.complete();
        // Readers are closed now. Do not keep a deadline timer alive while the
        // consumer processes the terminal completion event.
        clearTimeout(timeout);
        clearTimeout(headersTimeout);
        yield { type: 'complete', completion };
        return;
      }
    } catch (error) {
      if (signal?.aborted) throw new OpenAICompatibleError('Request cancelled.');
      if (controller.signal.aborted) throw new OpenAICompatibleError('Request timed out.');
      if (error instanceof OpenAICompatibleError) throw error;
      // Never include upstream bodies, URLs, fetch error causes or request headers.
      throw new OpenAICompatibleError('Request failed or response was interrupted.');
    } finally {
      clearTimeout(timeout);
      clearTimeout(headersTimeout);
      controller.abort();
      // A reader may already have closed/cancelled this stream.
      await response?.body?.cancel().catch(() => {});
    }
    try {
      await delay(backoff, undefined, { signal });
    } catch {
      throw new OpenAICompatibleError('Request cancelled.');
    }
  }
}
