import { z } from 'zod';

export const AgentConversationEntrySchema = z.object({
  id: z.string(),
  runId: z.string(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  kind: z.enum([
    'session_start',
    'assistant',
    'thinking',
    'tool_call',
    'tool_result',
    'error',
    'session_end',
    'legacy',
  ]),
  content: z.string(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  input: z.unknown().optional(),
  status: z.enum(['completed', 'failed', 'interrupted']).optional(),
});
