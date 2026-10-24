import { describe, expect, it } from 'vitest';
import type { ContentBlock, ProviderMessage } from '@automaker/types';
import {
  AgentStreamNormalizer,
  normalizeAgentProviderError,
} from '../../../src/services/agent/agent-stream-normalizer.js';

function state(factory = new AgentStreamNormalizer()) {
  let id = 0;
  return factory.create((content) => ({
    id: `message-${++id}`,
    role: 'assistant',
    content,
    timestamp: 'fixture-time',
  }));
}
const assistant = (...content: ContentBlock[]): ProviderMessage => ({
  type: 'assistant',
  message: { role: 'assistant', content },
});
describe('AgentStreamNormalizer query state', () => {
  it('accumulates text using a single stable message ID and cumulative wire payloads', () => {
    const stream = state();
    const first = stream.consume(assistant({ type: 'text', text: 'Hello' }));
    const second = stream.consume(assistant({ type: 'text', text: ' world' }));
    expect(first.newMessage).toBe(stream.message);
    expect(second.newMessage).toBeUndefined();
    expect(stream.message).toEqual({
      id: 'message-1',
      role: 'assistant',
      content: 'Hello world',
      timestamp: 'fixture-time',
    });
    expect(first.events).toEqual([
      { type: 'stream', messageId: 'message-1', content: 'Hello', isComplete: false },
    ]);
    expect(second.events).toEqual([
      { type: 'stream', messageId: 'message-1', content: 'Hello world', isComplete: false },
    ]);
  });
  it('keeps text/tool event order inside a multi-block assistant message', () => {
    const stream = state();
    const result = stream.consume(
      assistant(
        { type: 'text', text: 'Before' },
        { type: 'tool_use', name: 'Read', tool_use_id: 'tool', input: { path: 'README.md' } },
        { type: 'tool_result', tool_use_id: 'tool', content: 'Contents' },
        { type: 'text', text: 'After' }
      )
    );
    expect(result.events.map((event) => event.type)).toEqual([
      'stream',
      'tool_use',
      'tool_result',
      'stream',
    ]);
    expect(result.events[2]).toMatchObject({
      tool: { name: 'Read', input: { toolUseId: 'tool', content: 'Contents' } },
    });
    expect(stream.message?.content).toBe('BeforeAfter');
  });
  it('returns completion only as a draft, never among publishable chunk events', () => {
    const stream = state();
    stream.consume(assistant({ type: 'text', text: 'Partial' }));
    const result = stream.consume({ type: 'result', subtype: 'success', result: 'Final' });
    expect(result.events).toEqual([]);
    expect(stream.modelSucceeded).toBe(true);
    expect(stream.message?.content).toBe('Final');
    expect(stream.completion).toEqual({
      type: 'complete',
      messageId: 'message-1',
      content: 'Final',
      toolUses: [],
    });
  });

  it('correlates native SDK tool_use.id with user tool results while ignoring user text echoes', () => {
    const stream = state();
    const nativeTool: ContentBlock & { id: string } = {
      type: 'tool_use',
      id: 'sdk-tool',
      name: 'Read',
      input: { file_path: 'README.md' },
    };
    stream.consume(assistant(nativeTool));
    const result = stream.consume({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Do not render this user echo' },
          { type: 'tool_use', name: 'IgnoreUserTool', tool_use_id: 'sdk-tool' },
          { type: 'tool_result', tool_use_id: 'sdk-tool', content: 'Native SDK contents' },
        ],
      },
    });
    expect(result.events).toEqual([
      {
        type: 'tool_result',
        tool: {
          name: 'Read',
          input: { toolUseId: 'sdk-tool', content: 'Native SDK contents' },
        },
      },
    ]);
    expect(stream.message).toBeNull();
  });
  it('creates a persisted assistant message and stream event for a result-only provider', () => {
    const stream = state();
    const result = stream.consume({
      type: 'result',
      subtype: 'success',
      result: 'Buffered answer',
    });
    expect(result.newMessage).toBe(stream.message);
    expect(result.newMessage?.content).toBe('Buffered answer');
    expect(result.events).toEqual([
      { type: 'stream', messageId: 'message-1', content: 'Buffered answer', isComplete: false },
    ]);
    expect(stream.completion).toMatchObject({ messageId: 'message-1', content: 'Buffered answer' });
  });
  it('retains partial text on an unsuccessful result without claiming model success', () => {
    const stream = state();
    stream.consume(assistant({ type: 'text', text: 'Partial' }));
    stream.consume({ type: 'result', subtype: 'error_max_turns', result: 'Not a success answer' });
    expect(stream.responseText).toBe('Partial');
    expect(stream.modelSucceeded).toBe(false);
  });
  it('does not manufacture assistant messages for empty/tool-only results', () => {
    const stream = state();
    stream.consume(assistant({ type: 'tool_use', input: {} }));
    const result = stream.consume({ type: 'result', subtype: 'success' });
    expect(result.newMessage).toBeUndefined();
    expect(stream.message).toBeNull();
    expect(stream.completion).toMatchObject({ toolUses: [{ name: 'unknown', input: {} }] });
  });
  it('ignores missing text, thinking and user echo instead of rendering undefined', () => {
    const stream = state();
    expect(
      stream.consume(assistant({ type: 'text' }, { type: 'thinking', thinking: 'Private' })).events
    ).toEqual([]);
    expect(
      stream.consume({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Echo' }] },
      }).events
    ).toEqual([]);
    expect(stream.message).toBeNull();
  });
  it('isolates text, tool-name maps and completion snapshots between runs', () => {
    const factory = new AgentStreamNormalizer();
    const first = state(factory),
      second = state(factory);
    first.consume(
      assistant({ type: 'tool_use', name: 'Write', tool_use_id: 'same-id', input: {} })
    );
    first.consume({ type: 'result', subtype: 'success' });
    expect(
      second.consume(assistant({ type: 'tool_result', tool_use_id: 'same-id', content: 'New run' }))
        .events[0]
    ).toMatchObject({ tool: { name: 'unknown' } });
    expect(second.completion).toBeUndefined();
    expect(second.responseText).toBe('');
  });
  it.each([
    ['plain', 'plain'],
    [undefined, ''],
    [null, ''],
    [{ value: 42 }, '{"value":42}'],
    [
      [{ type: 'text', text: 'Text' }, 'Raw', { type: 'image' }, null, 42],
      'Text\nRaw\n[image]\nnull\n42',
    ],
  ])('normalizes tool results to text: %j', (content, expected) => {
    const stream = state();
    const result = stream.consume(
      assistant({ type: 'tool_result', tool_use_id: 'unknown', content } as ContentBlock)
    );
    expect(result.events).toEqual([
      {
        type: 'tool_result',
        tool: { name: 'unknown', input: { toolUseId: 'unknown', content: expected } },
      },
    ]);
  });
  it('exposes normalized provider errors without a completion or synthetic success', () => {
    const stream = state();
    const result = stream.consume({
      type: 'error',
      error: '\u001b[31mError: Session not found\u001b[0m',
    });
    expect(result.error).toMatchObject({ text: 'Session not found', staleSession: true });
    expect(result.events).toEqual([]);
    expect(stream.completion).toBeUndefined();
    expect(stream.modelSucceeded).toBe(false);
  });
});

describe('provider error normalization', () => {
  it.each(['Session not found', 'Session expired', 'Invalid session', 'No such session'])(
    'recognizes stale SDK IDs: %s',
    (error) => {
      expect(normalizeAgentProviderError(new Error(error)).staleSession).toBe(true);
    }
  );
  it('cleans thrown string, Error and message-object failures consistently', () => {
    const text = '\u001b[31mError: Fixture failed\u001b[0m';
    for (const error of [text, new Error(text), { message: text }]) {
      expect(normalizeAgentProviderError(error).text).toBe('Fixture failed');
    }
  });
  it.each([undefined, null, '', '\u001b[31m\u001b[0m', { message: 42 }])(
    'supplies a readable fallback for %j',
    (error) => {
      expect(normalizeAgentProviderError(error).text).toBe(
        'Unexpected error from provider during agent execution.'
      );
    }
  );
  it('adds a rate-limit hint only for streamed errors and retains provider advice', () => {
    const error = '429 rate_limit exceeded. Provider advice: reduce concurrency.';
    expect(normalizeAgentProviderError(error).text).toBe(error);
    expect(normalizeAgentProviderError(error, true).text).toContain(`${error}\n\nTip:`);
    expect(normalizeAgentProviderError('Other error', true).text).toBe('Other error');
  });
});
