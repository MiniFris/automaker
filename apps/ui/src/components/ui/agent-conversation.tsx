import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  LockKeyhole,
  LoaderCircle,
  Minus,
  UserRound,
  Wrench,
} from 'lucide-react';
import type { AgentConversationEntry } from '@automaker/types';
import { getFormattingLocale, translate, useUiLocale } from '@/lib/i18n';
import { groupAgentConversation, parseLegacyConversation } from '@/lib/agent-conversation';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import { Button } from './button';

function MessageTime({ timestamp }: { timestamp?: string }) {
  if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return null;
  const date = new Date(timestamp);
  return (
    <time
      dateTime={timestamp}
      title={date.toLocaleString(getFormattingLocale())}
      className="text-[11px] tabular-nums text-muted-foreground/70"
    >
      {date.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}

function Message({
  task = false,
  timestamp,
  children,
}: {
  task?: boolean;
  timestamp?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('flex items-start gap-2.5 sm:gap-3', task && 'flex-row-reverse')}
      data-testid={task ? 'chat-task' : 'chat-assistant'}
    >
      <div
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          task ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
        )}
      >
        {task ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <article
        className={cn(
          'min-w-0 max-w-[calc(100%_-_2.75rem)]',
          task ? 'w-fit sm:max-w-[85%]' : 'flex-1'
        )}
      >
        <div className={cn('mb-1.5 flex items-center gap-2 px-1', task && 'justify-end')}>
          <span className="text-xs font-medium text-foreground/80">
            {translate(task ? 'Task' : 'Agent')}
          </span>
          <MessageTime timestamp={timestamp} />
        </div>
        <div
          className={cn(
            'min-w-0 break-words rounded-2xl px-4 py-3 text-sm shadow-sm',
            task
              ? 'rounded-tr-sm border border-primary/10 bg-primary/10'
              : 'rounded-tl-sm bg-muted/40'
          )}
        >
          {children}
        </div>
      </article>
    </div>
  );
}

function toolPreview(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const values = input as Record<string, unknown>;
  for (const key of ['command', 'file_path', 'filePath', 'file', 'path', 'pattern', 'query', 'url'])
    if (typeof values[key] === 'string') return values[key].replace(/\s+/g, ' ').slice(0, 180);
  return '';
}

function formatToolOutput(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function ToolActivity({
  entry,
  result,
  ended,
}: {
  entry: AgentConversationEntry;
  result?: AgentConversationEntry;
  ended: boolean;
}) {
  const failed = result?.status === 'failed';
  const status = failed
    ? translate('Failed')
    : result
      ? translate('Completed')
      : ended
        ? translate('No result recorded')
        : translate('Running');
  const StatusIcon = failed ? CircleAlert : result ? Check : ended ? Minus : LoaderCircle;
  const preview = toolPreview(entry.input);
  return (
    <details className="group/tool min-w-0" data-testid="chat-tool">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-open/tool:rotate-90"
        />
        <Wrench aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-[45%] truncate font-medium text-foreground/80">
          {entry.toolName ?? translate('Tool')}
        </span>
        {preview && (
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={preview}>
            {preview}
          </span>
        )}
        <span
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1.5 text-[11px]',
            failed ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          <StatusIcon
            aria-hidden="true"
            className={cn('h-3.5 w-3.5', !result && !ended && 'animate-spin')}
          />
          <span className="sr-only sm:not-sr-only">{status}</span>
        </span>
      </summary>
      <div className="ml-5 space-y-3 border-l border-border/60 py-2 pl-3 text-xs">
        {entry.input !== undefined && (
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground">{translate('Input')}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 p-3 font-mono">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </div>
        )}
        {result && (
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground">{translate('Output')}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 p-3 font-mono">
              {formatToolOutput(result.content)}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

export function AgentConversation({
  entries,
  legacyOutput,
  loading,
  error,
  active = false,
  taskDescription,
}: {
  entries: AgentConversationEntry[];
  legacyOutput: string;
  loading: boolean;
  error?: string;
  active?: boolean;
  taskDescription?: string;
}) {
  useUiLocale();
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [hasNew, setHasNew] = useState(false);
  // Both older tasks and imported history use the same conversation presentation.
  const visibleEntries = useMemo(
    () =>
      entries.length
        ? entries.flatMap((entry) =>
            entry.kind === 'legacy' ? parseLegacyConversation(entry.content, entry.id) : [entry]
          )
        : parseLegacyConversation(legacyOutput),
    [entries, legacyOutput]
  );
  const grouped = useMemo(() => groupAgentConversation(visibleEntries), [visibleEntries]);
  const results = useMemo(
    () =>
      new Map(
        visibleEntries
          .filter((e) => e.kind === 'tool_result' && e.toolCallId)
          .map((e) => [`${e.runId}:${e.toolCallId}`, e])
      ),
    [visibleEntries]
  );
  const calls = useMemo(
    () =>
      new Set(
        visibleEntries
          .filter((e) => e.kind === 'tool_call' && e.toolCallId)
          .map((e) => `${e.runId}:${e.toolCallId}`)
      ),
    [visibleEntries]
  );
  const ended = useMemo(
    () => new Set(entries.filter((e) => e.kind === 'session_end').map((e) => e.runId)),
    [entries]
  );
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    else setHasNew(true);
  }, [visibleEntries]);
  const goToBottom = () => {
    follow.current = true;
    setHasNew(false);
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="agent-chat">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <LockKeyhole aria-hidden="true" className="h-3 w-3" />
          {translate('Agent history · read-only')}
        </span>
        {active && (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {translate('Running')}
          </span>
        )}
      </div>
      <div
        ref={scroll}
        onScroll={() => {
          if (!scroll.current) return;
          const { scrollHeight, scrollTop, clientHeight } = scroll.current;
          follow.current = scrollHeight - scrollTop - clientHeight < 50;
          if (follow.current) setHasNew(false);
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/40 scrollbar-visible"
        data-testid="agent-chat-history"
      >
        <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-5 sm:space-y-6 sm:px-6">
          {taskDescription?.trim() && (
            <Message task>
              <Markdown className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                {taskDescription}
              </Markdown>
            </Message>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {!visibleEntries.length && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading
                ? translate('Loading output...')
                : translate('No output yet. The agent will stream output here as it works.')}
            </p>
          )}
          {grouped.map((entry) => {
            if (
              entry.kind === 'tool_result' &&
              entry.toolCallId &&
              calls.has(`${entry.runId}:${entry.toolCallId}`)
            )
              return null;
            switch (entry.kind) {
              case 'session_start':
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground/70"
                    data-testid="chat-session-start"
                  >
                    <span className="h-px flex-1 bg-border/50" />
                    <span className="shrink-0">
                      {translate('Session started')}
                      {entry.timestamp &&
                        ` · ${new Date(entry.timestamp).toLocaleString(getFormattingLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                    <span className="h-px flex-1 bg-border/50" />
                  </div>
                );
              case 'session_end':
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-muted-foreground"
                    data-testid="chat-session-end"
                  >
                    {entry.status === 'completed' && (
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {entry.status === 'interrupted'
                        ? translate('Interrupted')
                        : entry.status === 'failed'
                          ? translate('Failed')
                          : translate('Completed')}
                    </span>
                    <MessageTime timestamp={entry.timestamp} />
                  </div>
                );
              case 'tool_call':
              case 'tool_result':
                return (
                  <div key={entry.id} className="min-w-0 pl-[42px] sm:pl-11">
                    <ToolActivity
                      entry={entry}
                      result={
                        entry.kind === 'tool_result'
                          ? entry
                          : results.get(`${entry.runId}:${entry.toolCallId}`)
                      }
                      ended={ended.has(entry.runId) || !active || !entry.timestamp}
                    />
                  </div>
                );
              case 'thinking':
                return (
                  <div key={entry.id} className="min-w-0 pl-[42px] sm:pl-11">
                    <details className="group/thinking" data-testid="chat-thinking">
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5 transition-transform group-open/thinking:rotate-90"
                        />
                        <Brain aria-hidden="true" className="h-3.5 w-3.5" />
                        {translate('Thinking')}
                        <MessageTime timestamp={entry.timestamp} />
                      </summary>
                      <div className="ml-5 border-l border-border/60 py-1 pl-3">
                        <Markdown>{entry.content}</Markdown>
                      </div>
                    </details>
                  </div>
                );
              case 'error':
                return (
                  <div
                    key={entry.id}
                    role="alert"
                    className="ml-[42px] flex gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive sm:ml-11"
                  >
                    <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="whitespace-pre-wrap break-words">{entry.content}</p>
                  </div>
                );
              default:
                return (
                  <Message key={entry.id} timestamp={entry.timestamp}>
                    <Markdown className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                      {entry.content}
                    </Markdown>
                  </Message>
                );
            }
          })}
          {active && (
            <div
              role="status"
              className="flex items-center gap-2 pl-[42px] text-xs text-muted-foreground sm:pl-11"
            >
              <span aria-hidden="true" className="flex gap-1">
                <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
              </span>
              {translate('Running')}
            </div>
          )}
        </div>
      </div>
      {hasNew && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border shadow-lg"
          onClick={goToBottom}
          data-testid="chat-new-messages"
        >
          <ArrowDown className="mr-1 h-4 w-4" />
          {translate('New messages')}
        </Button>
      )}
    </div>
  );
}
