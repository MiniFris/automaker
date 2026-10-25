/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface AgentModelInput {
  sessionId: string;
  model: string;
  providerId?: string | undefined;
}

export interface AgentQueueAddInput {
  message: string;
  sessionId: string;
  model?: string | undefined;
  providerId?: string | undefined;
  imagePaths?: string[] | undefined;
  thinkingLevel?: 'low' | 'medium' | 'high' | 'none' | 'ultrathink' | 'adaptive' | undefined;
}

export interface AgentQueueRemoveInput {
  sessionId: string;
  promptId: string;
}

export interface AgentSendInput {
  sessionId: string;
  message: string;
  workingDirectory?: string | undefined;
  imagePaths?: string[] | undefined;
  model?: string | undefined;
  providerId?: string | undefined;
  thinkingLevel?: 'low' | 'medium' | 'high' | 'none' | 'ultrathink' | 'adaptive' | undefined;
}

export interface AgentSessionInput {
  sessionId: string;
}

export interface AgentStartInput {
  sessionId: string;
  workingDirectory?: string | undefined;
}
