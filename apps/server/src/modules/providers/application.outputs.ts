/** Application results; controllers retain HTTP response validation. */
export interface ProviderDisconnectResult {
  success: true;
  message: string;
  connected: false;
  target: {
    kind: 'host-application';
    instanceId: string;
    provider: 'cursor' | 'claude' | 'codex' | 'gemini' | 'copilot' | 'opencode';
    workingDirectory: string;
  };
}

export interface ProviderReconnectResult {
  success: true;
  message: string;
  connected: true;
  target: {
    kind: 'host-application';
    instanceId: string;
    provider: 'cursor' | 'claude' | 'codex' | 'gemini' | 'copilot' | 'opencode';
    workingDirectory: string;
  };
  credentialStatus: 'not-detected' | 'present-unverified' | 'not-inspected';
  wasAlreadyAuthenticated?: boolean | undefined;
  requiresManualAuth?: boolean | undefined;
}
