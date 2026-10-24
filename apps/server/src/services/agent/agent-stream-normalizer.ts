import type { ProviderMessage } from '@automaker/types';
import { classifyError } from '@automaker/utils';
import type { Message } from './agent-session.types.js';

export type AgentStreamEvent = Record<string, unknown> & { type: string };

export function normalizeAgentProviderError(error: unknown, rateLimitHint = false) {
  const fallback = 'Unexpected error from provider during agent execution.';
  const raw =
    typeof error === 'string'
      ? error
      : error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : '';
  const text =
    raw
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim()
      .replace(/^Error:\s*/i, '')
      .trim() || fallback;
  const classification = classifyError(new Error(text));
  const lower = text.toLowerCase();
  return {
    text:
      rateLimitHint && classification.isRateLimit
        ? `${text}\n\nTip: It looks like you hit a rate limit. Try waiting a bit or reducing concurrent Agent Runner / Auto Mode tasks.`
        : text,
    staleSession: [
      'session not found',
      'session expired',
      'invalid session',
      'no such session',
    ].some((phrase) => lower.includes(phrase)),
    classification,
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === undefined || content === null) return '';
  if (Array.isArray(content))
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if ('text' in part && typeof part.text === 'string') return part.text;
          if ('type' in part && typeof part.type === 'string') return `[${part.type}]`;
        }
        return JSON.stringify(part) ?? '';
      })
      .join('\n');
  return JSON.stringify(content) ?? '';
}

/** A query-local accumulator. No persistence, subscriptions, provider execution or shared state. */
export class AgentStreamState {
  private currentMessage: Message | null = null;
  private text = '';
  private succeeded = false;
  private completionEvent?: AgentStreamEvent;
  private readonly toolUses: Array<{ name: string; input: unknown }> = [];
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly createMessage: (content: string) => Message) {}

  get message() {
    return this.currentMessage;
  }
  get responseText() {
    return this.text;
  }
  get modelSucceeded() {
    return this.succeeded;
  }
  // Only a draft: the application may publish it after iterator cleanup and durable save.
  get completion() {
    return this.completionEvent;
  }

  consume(msg: ProviderMessage): {
    newMessage?: Message;
    events: AgentStreamEvent[];
    error?: ReturnType<typeof normalizeAgentProviderError>;
  } {
    const events: AgentStreamEvent[] = [];
    let newMessage: Message | undefined;
    const updateText = (text: string) => {
      this.text = text;
      if (!this.currentMessage) {
        this.currentMessage = this.createMessage(text);
        newMessage = this.currentMessage;
      } else this.currentMessage.content = text;
    };
    const streamEvent = (): AgentStreamEvent => ({
      type: 'stream',
      messageId: this.currentMessage!.id,
      content: this.text,
      isComplete: false,
    });
    if (msg.type === 'assistant' || msg.type === 'user') {
      for (const block of msg.message?.content ?? []) {
        if (msg.type === 'assistant' && block.type === 'text' && typeof block.text === 'string') {
          updateText(this.text + block.text);
          events.push(streamEvent());
        } else if (msg.type === 'assistant' && block.type === 'tool_use') {
          const tool = { name: block.name || 'unknown', input: block.input };
          this.toolUses.push(tool);
          // Claude SDK emits tool_use.id; compatibility adapters use tool_use_id.
          const nativeId = 'id' in block && typeof block.id === 'string' ? block.id : undefined;
          const id = block.tool_use_id || nativeId;
          if (id) this.toolNames.set(id, tool.name);
          events.push({ type: 'tool_use', tool });
        } else if (block.type === 'tool_result') {
          events.push({
            type: 'tool_result',
            tool: {
              name: (block.tool_use_id && this.toolNames.get(block.tool_use_id)) || 'unknown',
              input: { toolUseId: block.tool_use_id, content: toolResultText(block.content) },
            },
          });
        }
      }
    } else if (msg.type === 'result') {
      this.succeeded = msg.subtype === 'success';
      if (this.succeeded && msg.result) {
        const resultOnly = !this.currentMessage;
        updateText(msg.result);
        if (resultOnly) events.push(streamEvent());
      }
      this.completionEvent = {
        type: 'complete',
        messageId: this.currentMessage?.id,
        content: this.text,
        toolUses: [...this.toolUses],
      };
    } else if (msg.type === 'error') {
      return { events, error: normalizeAgentProviderError(msg.error, true) };
    }
    return { events, newMessage };
  }
}

/** Singleton factory; all accumulators/tool-ID maps belong to individual queries. */
export class AgentStreamNormalizer {
  create(createMessage: (content: string) => Message): AgentStreamState {
    return new AgentStreamState(createMessage);
  }
}
