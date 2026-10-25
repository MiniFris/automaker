/**
 * Provider exports
 */

// Base providers
export { BaseProvider } from './base-provider.js';
export { terminalReason } from './provider-contract.js';
export type {
  ModelCapabilities,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderCapability,
  ProviderTerminalReason,
} from './provider-contract.js';
export {
  CliProvider,
  type SpawnStrategy,
  type CliSpawnConfig,
  type CliErrorInfo,
} from './cli-provider.js';
export type {
  ProviderConfig,
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
  AgentDefinition,
  ReasoningEffort,
  SystemPromptPreset,
  ConversationMessage,
  ContentBlock,
  ValidationResult,
  McpServerConfig,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
} from './types.js';

// Claude provider
export { ClaudeProvider } from './claude-provider.js';

// Cursor provider
export { CursorProvider, CursorErrorCode, CursorError } from './cursor-provider.js';
export { CursorConfigManager } from './cursor-config-manager.js';

// OpenCode provider
export { OpencodeProvider } from './opencode-provider.js';

// Gemini provider
export { GeminiProvider, GeminiErrorCode } from './gemini-provider.js';

// Copilot provider (GitHub Copilot SDK)
export { CopilotProvider, CopilotErrorCode } from './copilot-provider.js';

// OpenAI-compatible adapter
export { OpenAICompatibleProvider } from './openai-compatible-provider.js';
export { AgentCheckpointStore, parseCheckpoint } from './openai-compatible/checkpoint.js';

// Simple query service - unified interface for basic AI queries
export { simpleQuery, streamingQuery } from './simple-query-service.js';
export type {
  SimpleQueryOptions,
  SimpleQueryResult,
  StreamingQueryOptions,
} from './simple-query-service.js';
