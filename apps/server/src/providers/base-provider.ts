/**
 * Abstract base class for AI model providers
 */

import type {
  ProviderConfig,
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ValidationResult,
  ModelDefinition,
} from './types.js';
import type {
  ModelCapabilities,
  ProviderAdapter,
  ProviderCapabilities,
} from './provider-contract.js';
import { ProviderExecutionScope, managedProviderStream } from './provider-execution-scope.js';

/**
 * Base provider class that all provider implementations must extend
 */
export abstract class BaseProvider implements ProviderAdapter {
  protected config: ProviderConfig;
  protected name: string;
  private readonly executions = new ProviderExecutionScope();
  private executionOwner?: ProviderExecutionScope;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    this.name = this.getName();
  }

  /**
   * Get the provider name (e.g., "claude", "cursor")
   */
  abstract getName(): string;

  /**
   * Execute a query and stream responses
   * @param options Execution options
   * @returns AsyncGenerator yielding provider messages
   */
  protected abstract execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage>;

  executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    return managedProviderStream(
      options,
      (query) => this.execute(query),
      this.executions,
      this.executionOwner,
      this.cancellationMessages()
    );
  }

  protected cancellationMessages(): readonly ProviderMessage[] | undefined {
    return undefined;
  }

  attachExecutionScope(owner: ProviderExecutionScope): void {
    if (this.executionOwner && this.executionOwner !== owner)
      throw new Error('A provider instance cannot be shared between application execution scopes.');
    this.executionOwner = owner;
  }

  /**
   * Detect if the provider is installed and configured
   * @returns Installation status
   */
  abstract detectInstallation(): Promise<InstallationStatus>;

  /**
   * Get available models for this provider
   * @returns Array of model definitions
   */
  abstract getAvailableModels(): ModelDefinition[];

  getCapabilities(): ProviderCapabilities {
    const models = this.getAvailableModels();
    return Object.freeze({
      text: true,
      streaming: true,
      vision: models.some((model) => model.supportsVision === true),
      // Model metadata is authoritative. The legacy provider-level feature flag is
      // too broad and must not grant tools to a model that explicitly disables them.
      tools: models.some((model) => model.supportsTools === true),
      reasoning: models.some((model) => model.hasReasoning === true),
      mcp: this.supportsFeature('mcp'),
      remoteExecution: this.supportsFeature('remoteExecution'),
      followUp: true,
      cancellation: true,
    });
  }

  getModelCapabilities(modelId: string): ModelCapabilities {
    const normalized = modelId.toLowerCase();
    const model = this.getAvailableModels().find((candidate) => {
      const id = candidate.id.toLowerCase();
      const modelString = candidate.modelString.toLowerCase();
      return (
        id === normalized ||
        modelString === normalized ||
        id.endsWith(`-${normalized}`) ||
        modelString.endsWith(`-${normalized}`)
      );
    });
    return Object.freeze({
      vision: model?.supportsVision === true,
      tools: model?.supportsTools === true,
      reasoning: model?.hasReasoning === true,
    });
  }

  start(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    return this.executeQuery(options);
  }

  followUp(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    return this.executeQuery(options);
  }

  cancel(controller: AbortController): void {
    controller.abort();
  }

  dispose(): Promise<void> {
    return this.executions.dispose();
  }

  /**
   * Validate the provider configuration
   * @returns Validation result
   */
  validateConfig(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Base validation (can be overridden)
    if (!this.config) {
      errors.push('Provider config is missing');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if the provider supports a specific feature
   * @param feature Feature name (e.g., "vision", "tools", "mcp")
   * @returns Whether the feature is supported
   */
  supportsFeature(feature: string): boolean {
    // Default implementation - override in subclasses
    const commonFeatures = ['tools', 'text'];
    return commonFeatures.includes(feature);
  }

  /**
   * Get provider configuration
   */
  getConfig(): ProviderConfig {
    return this.config;
  }

  /**
   * Update provider configuration
   */
  setConfig(config: Partial<ProviderConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
