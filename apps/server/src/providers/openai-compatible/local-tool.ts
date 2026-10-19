import type { ChatToolDefinition } from './transport.js';

export interface LocalTool {
  definition: ChatToolDefinition;
  effect: 'read' | 'write' | 'shell' | 'state';
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
