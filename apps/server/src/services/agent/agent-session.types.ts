import type { ExecutionEnvironmentBinding, ThinkingLevel, ReasoningEffort } from '@automaker/types';

export interface AgentMessageInput {
  sessionId: string;
  message: string;
  workingDirectory?: string;
  imagePaths?: string[];
  model?: string;
  providerId?: string;
  thinkingLevel?: ThinkingLevel;
  reasoningEffort?: ReasoningEffort;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: Array<{ data: string; mimeType: string; filename: string }>;
  timestamp: string;
  isError?: boolean;
  deliveryId?: string;
  queuedPromptId?: string;
  deliveryStatus?: 'completed' | 'failed' | 'cancelled';
  runId?: string;
  executionStatus?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
}

export interface QueuedPrompt {
  id: string;
  message: string;
  imagePaths?: string[];
  model?: string;
  providerId?: string;
  thinkingLevel?: ThinkingLevel;
  addedAt: string;
  deliveryId?: string;
  deliveryStatus?: 'interrupted';
}

export interface ActiveSession {
  projectPath?: string;
  messages: Message[];
  isRunning: boolean;
  abortController: AbortController | null;
  workingDirectory: string;
  model?: string;
  providerId?: string;
  thinkingLevel?: ThinkingLevel;
  reasoningEffort?: ReasoningEffort;
  sdkSessionId?: string;
  promptQueue: QueuedPrompt[];
}

export interface SessionMetadata {
  executionEnvironment?: ExecutionEnvironmentBinding;
  id: string;
  name: string;
  projectPath?: string;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  tags?: string[];
  model?: string;
  providerId?: string;
  sdkSessionId?: string;
}
