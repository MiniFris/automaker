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
  ProviderFeatureCapabilities,
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
    return Object.freeze({
      text: true,
      streaming: true,
      vision: false,
      tools: false,
      reasoning: false,
      mcp: false,
      remoteExecution: false,
      ...this.featureCapabilities(),
      followUp: true,
      cancellation: true,
    });
  }

  protected featureCapabilities(): Partial<ProviderFeatureCapabilities> {
    return {};
  }

  protected resolveCapabilityModelId(modelId: string): string {
    return modelId;
  }

  getModelCapabilities(modelId: string): ModelCapabilities {
    const normalized = this.resolveCapabilityModelId(modelId.toLowerCase());
    if (!normalized || normalized.trim() !== normalized)
      return Object.freeze({ vision: false, tools: false, reasoning: false });
    const models = this.getAvailableModels();
    const exact = models.filter((model) => model.id.toLowerCase() === normalized);
    const matches = exact.length
      ? exact
      : models.filter((model) => model.modelString.toLowerCase() === normalized);
    // A bare SDK ID may identify several application models. Ambiguity must not
    // grant a feature just because the first matching entry enables it.
    return Object.freeze({
      vision: matches.length > 0 && matches.every((model) => model.supportsVision === true),
      tools: matches.length > 0 && matches.every((model) => model.supportsTools === true),
      reasoning: matches.length > 0 && matches.every((model) => model.hasReasoning === true),
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
