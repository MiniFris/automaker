import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentConversationEntry, ProviderMessage } from '@automaker/types';
import type { ExecutionFilesystem } from './execution-filesystem.js';

export const CONVERSATION_FILE = 'agent-conversation.jsonl';

/** Each record is durable before broadcast. The caller supplies the captured run fence. */
export class AgentConversationWriter {
  private readonly runId = randomUUID();
  private sequence = 0;
  private readonly tools = new Map<string, string>();

  constructor(
    private readonly directory: string,
    private readonly filesystem: ExecutionFilesystem,
    private readonly mutate: (operation: () => Promise<unknown>) => Promise<void>,
    private readonly publish: (entry: AgentConversationEntry) => void
  ) {}

  async start(previousContent?: string) {
    let exists = true;
    try {
      await this.filesystem.access(path.join(this.directory, CONVERSATION_FILE));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      exists = false;
    }
    // A newline also isolates an incomplete record left by a terminated process.
    await this.mutate(async () => {
      await this.filesystem.mkdir(this.directory, { recursive: true });
      await this.filesystem.appendFile(path.join(this.directory, CONVERSATION_FILE), '\n');
    });
    if (!exists && previousContent?.trim()) await this.append('legacy', previousContent);
    await this.append('session_start', '');
  }

  private async append(
    kind: AgentConversationEntry['kind'],
    content: string,
    extra: Partial<AgentConversationEntry> = {}
  ) {
    const sequence = this.sequence++;
    const entry: AgentConversationEntry = {
      ...extra,
      id: `${this.runId}:${sequence}`,
      runId: this.runId,
      sequence,
      timestamp: new Date().toISOString(),
      kind,
      content,
    };
    await this.mutate(() =>
      this.filesystem.appendFile(
        path.join(this.directory, CONVERSATION_FILE),
        `${JSON.stringify(entry)}\n`
      )
    );
    this.publish(entry);
  }

  async observe(message: ProviderMessage, includeResult: boolean) {
    for (const block of message.message?.content ?? []) {
      if (message.type === 'assistant' && block.type === 'text' && block.text)
        await this.append('assistant', block.text);
      else if (message.type === 'assistant' && block.type === 'thinking' && block.thinking)
        await this.append('thinking', block.thinking);
      else if (message.type === 'assistant' && block.type === 'tool_use') {
        const toolCallId = block.id ?? block.tool_use_id;
        if (toolCallId) this.tools.set(toolCallId, block.name ?? 'Tool');
        await this.append('tool_call', '', {
          toolName: block.name,
          toolCallId,
          input: block.input,
        });
      } else if (block.type === 'tool_result') {
        await this.append(
          'tool_result',
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
          {
            toolCallId: block.tool_use_id,
            toolName: this.tools.get(block.tool_use_id ?? ''),
            status: block.is_error ? 'failed' : 'completed',
          }
        );
      }
    }
    if (
      message.type === 'result' &&
      message.subtype === 'success' &&
      includeResult &&
      message.result
    )
      await this.append('assistant', message.result);
  }

  async finish(status: 'completed' | 'failed' | 'interrupted', error?: string) {
    if (error) await this.append('error', error);
    await this.append('session_end', '', { status });
  }
}
