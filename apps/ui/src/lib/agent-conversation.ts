import type { AgentConversationEntry } from '@automaker/types';

function hasMessageContent(content: string): boolean {
  return content.split('\n').some((line) => {
    const text = line.trim();
    return text.length > 0 && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(text.replace(/[ \t]/g, ''));
  });
}

/** Snapshot and WebSocket delivery can overlap; immutable IDs make replay idempotent. */
export function mergeAgentConversation(
  snapshot: AgentConversationEntry[],
  live: AgentConversationEntry[]
): AgentConversationEntry[] {
  const seen = new Set<string>();
  return [...snapshot, ...live].filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function groupAgentConversation(
  entries: AgentConversationEntry[]
): AgentConversationEntry[] {
  const grouped: AgentConversationEntry[] = [];
  for (const entry of entries) {
    const last = grouped.at(-1);
    if (
      last &&
      last.runId === entry.runId &&
      last.kind === entry.kind &&
      (entry.kind === 'assistant' || entry.kind === 'thinking')
    ) {
      grouped[grouped.length - 1] = { ...last, content: last.content + entry.content };
    } else grouped.push(entry);
  }
  return grouped.filter(
    (entry) =>
      (entry.kind !== 'assistant' && entry.kind !== 'thinking') || hasMessageContent(entry.content)
  );
}

function legacyToolInput(
  lines: string[],
  start: number
): { input: unknown; end: number } | undefined {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let started = false;
  for (let index = start; index < lines.length; index++) {
    const part = index === start ? lines[index].slice('Input:'.length).trim() : lines[index];
    if (index > start && /^(?:🔧\s*)?Tool:|^## Follow-up Session/.test(part)) return;
    parts.push(part);
    if (!started && part.trim()) {
      if (!/^[{[]/.test(part.trim())) {
        try {
          return { input: JSON.parse(part), end: index };
        } catch {
          return;
        }
      }
      started = true;
    }
    for (const char of part) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quoted && char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') depth--;
    }
    if (started && depth === 0 && !quoted) {
      try {
        return { input: JSON.parse(parts.join('\n')), end: index };
      } catch {
        return;
      }
    }
  }
}

function legacyToolResult(lines: string[], start: number) {
  const heading = lines[start]?.match(/^### (.+?) \(([^()\s]+)\)\s*$/);
  if (!heading) return;
  let opening = start + 1;
  while (opening < lines.length && !lines[opening].trim()) opening++;
  if (!/^```json\s*$/.test(lines[opening] ?? '')) return;
  let closing = opening + 1;
  while (closing < lines.length && !/^```\s*$/.test(lines[closing])) closing++;
  if (closing === lines.length) return;
  const content = lines.slice(opening + 1, closing).join('\n');
  let failed = false;
  try {
    const value = JSON.parse(content);
    failed =
      value?.ok === false ||
      value?.success === false ||
      value?.is_error === true ||
      value?.status === 'error';
  } catch {
    /* Non-JSON tool output is also valid in the historical fenced format. */
  }
  return {
    toolName: heading[1],
    toolCallId: heading[2],
    content,
    status: failed ? ('failed' as const) : ('completed' as const),
    end: closing,
  };
}

function pairLegacyToolResults(entries: AgentConversationEntry[]) {
  const calls = new Map<string, AgentConversationEntry[]>();
  const results = new Map<string, AgentConversationEntry[]>();
  for (const entry of entries) {
    const group =
      entry.kind === 'tool_call' ? calls : entry.kind === 'tool_result' ? results : undefined;
    if (!group) continue;
    const key = JSON.stringify([entry.runId, entry.toolName]);
    const items = group.get(key) ?? [];
    items.push(entry);
    group.set(key, items);
  }
  for (const [key, candidates] of calls) {
    const matches = results.get(key);
    // Old calls omitted IDs. Only link an unambiguous pair; parallel calls with
    // the same name must not borrow each other's result based on completion order.
    if (candidates.length === 1 && matches?.length === 1)
      candidates[0].toolCallId = matches[0].toolCallId;
  }
  return entries;
}

/** Read the historical text format without treating code examples as actual tool calls. */
export function parseLegacyConversation(
  output: string,
  prefix = 'legacy'
): AgentConversationEntry[] {
  const lines = output.split('\n');
  const entries: AgentConversationEntry[] = [];
  let text: string[] = [];
  let startLine = 0;
  let run = 0;
  let fence: { character: string; length: number } | undefined;
  const push = (
    kind: AgentConversationEntry['kind'],
    content: string,
    line: number,
    extra = {}
  ) => {
    entries.push({
      id: `${prefix}:${line}:${kind}`,
      runId: `${prefix}:${run}`,
      sequence: line,
      timestamp: '',
      kind,
      content,
      ...extra,
    });
  };
  const flush = () => {
    const content = text.join('\n').trim();
    if (hasMessageContent(content)) push('assistant', content, startLine);
    text = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      const mark = delimiter[1];
      if (!fence) fence = { character: mark[0], length: mark.length };
      else if (mark[0] === fence.character && mark.length >= fence.length) fence = undefined;
      if (!text.length) startLine = index;
      text.push(line);
      continue;
    }
    if (!fence && /^## Follow-up Session\s*$/.test(line)) {
      // The executor inserts a Markdown rule before the session heading. It is
      // transport scaffolding, not an assistant reply (including after tool results).
      while (text.length && !text[text.length - 1].trim()) text.pop();
      if (text[text.length - 1]?.trim() === '---') text.pop();
      flush();
      run++;
      push('session_start', '', index);
      continue;
    }
    if (!fence && /^## Tool results\s*$/.test(line)) {
      let cursor = index + 1;
      while (cursor < lines.length && !lines[cursor].trim()) cursor++;
      let result = legacyToolResult(lines, cursor);
      if (result) {
        flush();
        while (result) {
          const { content, toolName, toolCallId, status, end } = result;
          push('tool_result', content, cursor, { toolName, toolCallId, status });
          index = end;
          cursor = end + 1;
          while (cursor < lines.length && !lines[cursor].trim()) cursor++;
          result = legacyToolResult(lines, cursor);
        }
        continue;
      }
    }
    const tool = !fence && line.match(/^(?:🔧\s*)?Tool:\s*(\S.*?)\s*$/);
    if (tool && (line.startsWith('🔧') || lines[index + 1]?.startsWith('Input:'))) {
      flush();
      let input: unknown;
      let lastInputLine = index;
      if (lines[index + 1]?.startsWith('Input:')) {
        const parsed = legacyToolInput(lines, index + 1);
        input = parsed?.input;
        lastInputLine = parsed?.end ?? index;
      }
      push('tool_call', '', index, { toolName: tool[1], ...(input !== undefined && { input }) });
      index = lastInputLine;
    } else {
      if (!text.length) startLine = index;
      text.push(line);
    }
  }
  flush();
  return pairLegacyToolResults(entries);
}
