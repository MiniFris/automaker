import type {
  ExecuteOptions,
  InstallationStatus,
  ModelDefinition,
  ProviderMessage,
} from './types.js';

export type ProviderCapability =
  | 'text'
  | 'streaming'
  | 'vision'
  | 'tools'
  | 'reasoning'
  | 'mcp'
  | 'remoteExecution'
  | 'followUp'
  | 'cancellation';

export interface ProviderCapabilities {
  readonly text: boolean;
  readonly streaming: boolean;
  readonly vision: boolean;
  readonly tools: boolean;
  readonly reasoning: boolean;
  readonly mcp: boolean;
  readonly remoteExecution: boolean;
  readonly followUp: boolean;
  readonly cancellation: boolean;
}

export interface ModelCapabilities {
  readonly vision: boolean;
  readonly tools: boolean;
  readonly reasoning: boolean;
}

export type ProviderTerminalReason =
  | 'completed'
  | 'cancelled'
  | 'max-turns'
  | 'invalid-structured-output'
  | 'budget-exceeded'
  | 'failed';

export interface ProviderAdapter {
  executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage>;
  getName(): string;
  detectInstallation(): Promise<InstallationStatus>;
  getAvailableModels(): ModelDefinition[];
  getCapabilities(): ProviderCapabilities;
  getModelCapabilities(modelId: string): ModelCapabilities;
  start(options: ExecuteOptions): AsyncGenerator<ProviderMessage>;
  followUp(options: ExecuteOptions): AsyncGenerator<ProviderMessage>;
  cancel(controller: AbortController): void;
  dispose(): Promise<void>;
}

export function terminalReason(message: ProviderMessage): ProviderTerminalReason | undefined {
  if (message.type === 'error') return 'failed';
  if (message.type !== 'result') return undefined;
  switch (message.subtype) {
    case 'success':
      return 'completed';
    case 'error_max_turns':
      return 'max-turns';
    case 'error_max_structured_output_retries':
      return 'invalid-structured-output';
    case 'error_max_budget_usd':
      return 'budget-exceeded';
    default:
      return 'failed';
  }
}
