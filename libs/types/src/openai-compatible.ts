/** Configuration shared by the UI and backend. Secrets are resolved only on the server. */
export type OpenAICompatibleProtocol = 'chat-completions' | 'responses';

export type OpenAICompatibleAuth =
  | { type: 'none' }
  | { type: 'env'; variableName: string }
  | { type: 'credentials'; credentialId: string };

export interface OpenAICompatibleCapabilities {
  tools: boolean;
  streaming: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
  reasoning?: boolean;
}

export interface OpenAICompatibleModel {
  /** Exact API model ID. It may contain slashes, colons and provider-like prefixes. */
  id: string;
  displayName: string;
  capabilities: OpenAICompatibleCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface OpenAICompatibleEndpoint {
  id: string;
  name: string;
  enabled: boolean;
  /** API base URL, including /v1 (or another API prefix) when required. */
  baseUrl: string;
  /** Explicit selection; switching protocols must never silently replay a request. */
  protocol: OpenAICompatibleProtocol;
  auth: OpenAICompatibleAuth;
  timeoutMs?: number;
  maxRetries?: number;
  models: OpenAICompatibleModel[];
}

/** Public settings DTO: secret values and even key fragments never leave the server. */
export interface OpenAICompatibleEndpointStatus {
  endpoint: OpenAICompatibleEndpoint;
  keyConfigured: boolean;
}

export type DirectAgentSettings = Pick<DirectAgentOptions, 'access' | 'shell' | 'limits'>;

/** Server-only request context. Never return this object in settings responses or logs. */
export interface ResolvedOpenAICompatibleConnection {
  endpointId: string;
  baseUrl: string;
  protocol: OpenAICompatibleProtocol;
  apiKey?: string;
  model: OpenAICompatibleModel;
  timeoutMs: number;
  maxRetries: number;
}

export interface DirectAgentToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface DirectAgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: DirectAgentToolCall[];
  tool_call_id?: string;
}

/** Server-local snapshot. Contains project text; never include it in UI settings or logs. */
export interface DirectAgentCheckpoint {
  version: 1;
  sessionId: string;
  endpointId: string;
  modelId: string;
  workspace: string;
  requestHash: string;
  tools: string[];
  status: 'running' | 'completed' | 'interrupted' | 'failed';
  turns: number;
  toolCalls: number;
  outputChars: number;
  elapsedMs: number;
  messages: DirectAgentMessage[];
}

export interface DirectAgentLimits {
  maxToolCalls?: number;
  maxDurationMs?: number;
  toolTimeoutMs?: number;
  maxContextBytes?: number;
  maxOutputChars?: number;
  maxRepeatedCalls?: number;
}

/** Server-only execution controls, not endpoint settings. */
export interface DirectAgentOptions {
  /** Server-granted policy. Omitted is read-only; readOnly:true can only restrict it. */
  access?: 'read-only' | 'workspace-write' | 'full-access';
  /** Trusted server configuration, never arguments supplied by the model. No image pulls. */
  shell?: {
    backend: 'docker';
    image: string;
    executable?: 'sh' | 'bash' | 'pwsh';
  };
  limits?: DirectAgentLimits;
  /** Resume the same request at a balanced message boundary, with consumed budgets retained. */
  checkpoint?: DirectAgentCheckpoint;
  /** Opt-in persistence. Callback receives a detached snapshot, never the endpoint connection. */
  onCheckpoint?: (checkpoint: DirectAgentCheckpoint) => void | Promise<void>;
}

export const DIRECT_MODEL_PREFIX = 'direct-';

/** Encode an API ID, even when the API ID itself starts with direct-. */
export function toDirectModelId(apiModelId: string): string {
  return `${DIRECT_MODEL_PREFIX}${apiModelId}`;
}

/** The outer prefix selects the runtime; providerId selects a particular endpoint. */
export function isDirectModel(model: string | null | undefined): boolean {
  return typeof model === 'string' && model.startsWith(DIRECT_MODEL_PREFIX);
}
