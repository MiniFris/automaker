import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { AgentConversationEntry } from '@automaker/types';
import { AgentConversation } from '@/components/ui/agent-conversation';
import {
  groupAgentConversation,
  mergeAgentConversation,
  parseLegacyConversation,
} from '@/lib/agent-conversation';

const entry = (
  sequence: number,
  kind: AgentConversationEntry['kind'],
  content = '',
  extra = {}
): AgentConversationEntry => ({
  id: `run:${sequence}`,
  runId: 'run',
  sequence,
  timestamp: '2026-01-01T00:00:00Z',
  kind,
  content,
  ...extra,
});
it('shows full Markdown messages, collapsible provider thinking and paired tool output without an input', () => {
  render(
    <AgentConversation
      entries={[
        entry(0, 'session_start'),
        entry(1, 'assistant', 'Checking **requirements**.\n\n'),
        entry(2, 'assistant', 'More details.'),
        entry(3, 'thinking', 'Provided reasoning'),
        entry(4, 'tool_call', '', {
          toolName: 'Read',
          toolCallId: 't1',
          input: { file: 'README.md' },
        }),
        entry(5, 'tool_result', 'Repository contents', { toolCallId: 't1', status: 'completed' }),
        entry(6, 'assistant', 'Finished.'),
        entry(7, 'session_end', '', { status: 'completed' }),
      ]}
      legacyOutput="Must not duplicate the transcript"
      loading={false}
    />
  );
  expect(screen.getAllByTestId('chat-assistant')).toHaveLength(2);
  expect(screen.getByText('requirements').tagName).toBe('STRONG');
  expect(screen.getByTestId('chat-thinking')).not.toHaveAttribute('open');
  expect(screen.getByTestId('chat-tool')).not.toHaveAttribute('open');
  fireEvent.click(screen.getByTestId('chat-tool').querySelector('summary')!);
  expect(screen.getByText('Repository contents')).toBeVisible();
  expect(screen.getAllByTestId('chat-tool')).toHaveLength(1);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText('Must not duplicate the transcript')).not.toBeInTheDocument();
});
it('merges overlapping snapshots and repeated deliveries by ID, keeping identical messages from different runs', () => {
  const first = entry(0, 'assistant', 'Same text');
  const second = entry(1, 'assistant', 'More');
  const other = { ...first, id: 'other:0', runId: 'other' };
  expect(mergeAgentConversation([first, second], [first, second, other, other])).toEqual([
    first,
    second,
    other,
  ]);
});
it('keeps history visible on failure and distinguishes an incomplete tool call from success', () => {
  render(
    <AgentConversation
      entries={[
        entry(0, 'tool_call', '', { toolName: 'Read' }),
        entry(1, 'error', 'Connection lost'),
        entry(2, 'session_end', '', { status: 'interrupted' }),
      ]}
      legacyOutput=""
      loading={false}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.getByText('No result recorded')).toBeInTheDocument();
  expect(screen.getByTestId('chat-session-end')).toHaveTextContent('Interrupted');
});
it('does not scroll away from earlier messages and offers an explicit jump to new messages', () => {
  const { rerender } = render(
    <AgentConversation
      entries={[entry(0, 'assistant', 'Earlier message')]}
      legacyOutput=""
      loading={false}
    />
  );
  const history = screen.getByTestId('agent-chat-history');
  Object.defineProperties(history, {
    scrollHeight: { value: 2000, configurable: true },
    clientHeight: { value: 300, configurable: true },
  });
  history.scrollTop = 100;
  fireEvent.scroll(history);
  rerender(
    <AgentConversation
      entries={[entry(0, 'assistant', 'Earlier message'), entry(1, 'assistant', 'New message')]}
      legacyOutput=""
      loading={false}
    />
  );
  expect(history.scrollTop).toBe(100);
  fireEvent.click(screen.getByTestId('chat-new-messages'));
  expect(history.scrollTop).toBe(2000);
  expect(screen.queryByTestId('chat-new-messages')).not.toBeInTheDocument();
});

it('renders older task output as a conversation, preserving replies after tool JSON and code examples', () => {
  const output =
    'I will inspect the files.\n\n🔧 Tool: Read\nInput: {\n  "file_path": "src/app.ts",\n  "nested": {"escaped": "} \\\" ["}\n}\n\n## Result\nImplemented the fix.\n\n```text\n🔧 Tool: ExampleOnly\nInput: {}\n```';
  const entries = parseLegacyConversation(output);
  expect(entries.map((entry) => entry.kind)).toEqual(['assistant', 'tool_call', 'assistant']);
  expect(entries[1]).toMatchObject({ toolName: 'Read', input: { file_path: 'src/app.ts' } });
  expect(entries[2].content).toContain('Implemented the fix.');
  expect(entries[2].content).toContain('🔧 Tool: ExampleOnly');
  render(
    <AgentConversation
      entries={[]}
      legacyOutput={output}
      loading={false}
      taskDescription="Fix the application"
    />
  );
  expect(screen.getByTestId('chat-task')).toHaveTextContent('Fix the application');
  expect(screen.getAllByTestId('chat-assistant')).toHaveLength(2);
  expect(screen.getAllByTestId('chat-tool')).toHaveLength(1);
  expect(screen.getByTestId('chat-tool')).toHaveTextContent('src/app.ts');
  expect(screen.getByText('Implemented the fix.')).toBeInTheDocument();
  expect(screen.queryByRole('time')).not.toBeInTheDocument();
});

it('keeps malformed historical input readable and separates follow-up sessions', () => {
  const entries = parseLegacyConversation(
    '🔧 Tool: Read\nInput: {broken\nReply is preserved\n\n## Follow-up Session\nContinued work'
  );
  expect(entries.map((entry) => entry.kind)).toEqual([
    'tool_call',
    'assistant',
    'session_start',
    'assistant',
  ]);
  expect(entries[1].content).toContain('Reply is preserved');
  expect(entries[0].runId).not.toBe(entries.at(-1)?.runId);
});

it.each(['text', 'imported'] as const)(
  'attaches historical Tool results from %s history to their calls instead of rendering an agent reply',
  (source) => {
    const output =
      'Inspecting the project.\n\n🔧 Tool: LS\nInput: {"path":"/projects/temp2"}\n\nDone.\n\n## Tool results\n\n### LS (call-ls)\n\n```json\n{"ok":true,"result":{"entries":[{"name":"index.html"}]}}\n```';
    const parsed = parseLegacyConversation(output);
    expect(parsed.map((entry) => entry.kind)).toEqual([
      'assistant',
      'tool_call',
      'assistant',
      'tool_result',
    ]);
    expect(parsed[1].toolCallId).toBe('call-ls');
    expect(parsed[3]).toMatchObject({ toolCallId: 'call-ls', toolName: 'LS', status: 'completed' });
    render(
      <AgentConversation
        entries={source === 'imported' ? [entry(0, 'legacy', output)] : []}
        legacyOutput={output}
        loading={false}
      />
    );
    expect(screen.getAllByTestId('chat-assistant')).toHaveLength(2);
    expect(screen.getAllByTestId('chat-tool')).toHaveLength(1);
    expect(screen.queryByText('Tool results')).not.toBeInTheDocument();
    const card = screen.getByTestId('chat-tool');
    expect(card).toHaveTextContent('Completed');
    fireEvent.click(card.querySelector('summary')!);
    expect(card).toHaveTextContent('index.html');
    expect(card).toHaveTextContent('Input');
    expect(card).toHaveTextContent('Output');
  }
);

it('does not guess which repeated historical call produced an ambiguous result', () => {
  const parsed = parseLegacyConversation(
    '🔧 Tool: Read\nInput: {"file":"a"}\n🔧 Tool: Read\nInput: {"file":"b"}\n## Tool results\n### Read (b)\n\n```json\nB contents\n```\n### Read (a)\n\n```json\nA contents\n```'
  );
  expect(
    parsed.filter((entry) => entry.kind === 'tool_call').every((entry) => !entry.toolCallId)
  ).toBe(true);
  expect(
    parsed.filter((entry) => entry.kind === 'tool_result').map((entry) => entry.content)
  ).toEqual(['B contents', 'A contents']);
});

it('preserves a Tool results code example and an incomplete result block as text', () => {
  const example = '```md\n## Tool results\n### LS (example)\n\n~~~json\n{}\n~~~\n```';
  const incomplete = '## Tool results\n### LS (unfinished)\n\n```json\n{"ok":true';
  for (const text of [example, incomplete]) {
    const parsed = parseLegacyConversation(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ kind: 'assistant', content: text });
  }
});

it('does not render the stored follow-up separator as an empty agent bubble', () => {
  const output =
    'Earlier reply.\n\n🔧 Tool: Edit\nInput: {}\n\n## Tool results\n\n### Edit (edit-id)\n\n```json\n{"ok":true}\n```\n\n---\n\n## Follow-up Session\n\nNext reply.';
  const parsed = parseLegacyConversation(output);
  expect(
    parsed.filter((entry) => entry.kind === 'assistant').map((entry) => entry.content)
  ).toEqual(['Earlier reply.', 'Next reply.']);
  render(<AgentConversation entries={[]} legacyOutput={output} loading={false} />);
  expect(screen.getAllByTestId('chat-assistant')).toHaveLength(2);
  expect(screen.getByTestId('chat-session-start')).toBeInTheDocument();
  expect(screen.getByTestId('chat-tool')).toHaveTextContent('Completed');
});

it('hides whitespace and standalone rules after merging stream chunks, retaining real Markdown', () => {
  const entries = [
    entry(0, 'assistant', ' \n'),
    entry(1, 'tool_call'),
    entry(2, 'assistant', '---'),
    entry(3, 'session_start'),
    entry(4, 'assistant', 'A\n\n---\n\nB\n\n```text\n---\n```'),
  ];
  const messages = groupAgentConversation(entries).filter((entry) => entry.kind === 'assistant');
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toContain('A\n\n---\n\nB');
  expect(messages[0].content).toContain('```text\n---\n```');
});

it('matches historical results by tool name within each session, preserving explicit failures', () => {
  const output =
    '🔧 Tool: Read\nInput: {}\n🔧 Tool: LS\nInput: {}\n## Tool results\n### LS (list)\n\n```json\n{"ok":false,"error":"denied"}\n```\n### Read (read)\n\n```json\n{"ok":true}\n```\n## Follow-up Session\n🔧 Tool: LS\nInput: {}\n## Tool results\n### LS (other)\n\n```json\n{"ok":true}\n```';
  const parsed = parseLegacyConversation(output);
  const calls = parsed.filter((entry) => entry.kind === 'tool_call');
  expect(calls.map((entry) => entry.toolCallId)).toEqual(['read', 'list', 'other']);
  expect(
    parsed.find((entry) => entry.kind === 'tool_result' && entry.toolCallId === 'list')?.status
  ).toBe('failed');
});
