/** Task-scoped, append-only conversation events. Internal prompts are not recorded. */
export interface AgentConversationEntry {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  kind:
    | 'session_start'
    | 'assistant'
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'session_end'
    | 'legacy';
  content: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  status?: 'completed' | 'failed' | 'interrupted';
}
