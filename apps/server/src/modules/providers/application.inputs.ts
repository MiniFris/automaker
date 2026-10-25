/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface ProviderDisconnectInput {
  confirmed: true;
  target: {
    kind: 'host-application';
    instanceId: string;
    provider: 'cursor' | 'claude' | 'codex' | 'gemini' | 'copilot' | 'opencode';
    workingDirectory: string;
  };
}

export interface ProviderReconnectInput {
  confirmed: true;
  target: {
    kind: 'host-application';
    instanceId: string;
    provider: 'cursor' | 'claude' | 'codex' | 'gemini' | 'copilot' | 'opencode';
    workingDirectory: string;
  };
}

export type HostCliProvider = 'claude' | 'codex' | 'cursor' | 'gemini' | 'copilot' | 'opencode';
