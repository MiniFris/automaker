/** Portable application command, target and result values; no transport schema aliases. */
export interface SetupCredentialTargetValue {
  kind: 'application-credential';
  provider: 'anthropic' | 'openai' | 'google' | 'anthropic_oauth_token';
  instanceId: string;
  workingDirectory: string;
  credentialsPath: string;
}

export interface ClaudeVerificationTargetValue {
  kind: 'host-claude-verification';
  provider: 'claude';
  instanceId: string;
  workingDirectory: string;
  authMethod: 'cli' | 'api_key';
  endpoint: string;
  model: 'claude-sonnet-4-6';
}

export interface ClaudeVerificationInput {
  confirmed: true;
  target: ClaudeVerificationTargetValue;
  apiKey?: string;
}

export interface ClaudeVerificationResult {
  success: true;
  authenticated: boolean;
  target: ClaudeVerificationTargetValue;
  authType: 'cli' | 'api_key';
  verification: 'verified' | 'unverified';
  error?: string;
}

export interface CodexVerificationTargetValue {
  kind: 'host-codex-verification';
  provider: 'codex';
  instanceId: string;
  workingDirectory: string;
  authMethod: 'cli' | 'api_key';
  credentialKind: 'api-key' | 'chatgpt' | 'not-detected';
  credentialDirectory?: string;
  endpoint: string;
  model: 'gpt-5.2-codex';
}

export interface CodexVerificationInput {
  confirmed: true;
  target: CodexVerificationTargetValue;
  apiKey?: string;
}

export interface CodexVerificationResult {
  success: true;
  authenticated: boolean;
  target: CodexVerificationTargetValue;
  authType: 'cli' | 'api_key';
  verification: 'verified' | 'unverified';
  error?: string;
}

export interface GithubAuthenticationInput {
  confirmed: true;
  target: GithubAuthenticationTargetValue;
}

export interface GithubAuthenticationResult {
  success: true;
  target: GithubAuthenticationTargetValue;
  authenticationChecked: true;
  authenticated: boolean;
  user: string | null;
}

export interface GithubAuthenticationTargetValue {
  kind: 'host-github-authentication';
  provider: 'github';
  instanceId: string;
  workingDirectory: string;
  cliPath: string | null;
  hostname: string;
}
export interface SetupCredentialChangeInput {
  confirmed: true;
  target: SetupCredentialTargetValue;
  apiKey?: string;
}
