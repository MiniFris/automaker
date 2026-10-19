/**
 * Session types for agent conversations
 */

export interface AgentSession {
  executionEnvironment?: import('./execution-environment.js').ExecutionEnvironmentBinding;
  id: string;
  name: string;
  projectPath: string;
  workingDirectory?: string; // The worktree/directory this session runs in
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  isArchived: boolean;
  isDirty?: boolean; // Indicates session has completed work that needs review
  tags?: string[];
  model?: string;
  providerId?: string;
}

export interface SessionListItem extends AgentSession {
  preview?: string; // Last message preview
}

export interface CreateSessionParams {
  name: string;
  projectPath: string;
  workingDirectory?: string;
}

export interface UpdateSessionParams {
  id: string;
  name?: string;
  tags?: string[];
}
