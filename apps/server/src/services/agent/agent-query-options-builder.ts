import type { ExecuteOptions, ThinkingLevel, ReasoningEffort } from '@automaker/types';
import { createLogger } from '@automaker/utils';
import { createChatOptions, validateWorkingDirectory } from '../../lib/sdk-options.js';
import {
  getAutoLoadClaudeMdSetting,
  getUseClaudeCodeSystemPromptSetting,
  getMCPServersFromSettings,
  getSkillsConfiguration,
  getSubagentsConfiguration,
  getCustomSubagents,
  getDefaultMaxTurnsSetting,
} from '../../lib/settings-helpers.js';
import type { SettingsService } from '../settings-service.js';
import { AgentProviderSelector } from './agent-provider-selector.js';
import type { ActiveSession } from './agent-session.types.js';

const BASE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'LS',
  'Bash',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
];

/** Loads chat configuration and builds SDK/tool options, without starting a provider. */
export class AgentQueryOptionsBuilder {
  private readonly logger = createLogger('AgentQueryOptionsBuilder');
  constructor(
    private readonly providers: AgentProviderSelector,
    private readonly validateDirectory: (cwd: string) => void = validateWorkingDirectory
  ) {}

  async configuration(input: {
    workingDirectory: string;
    settings: SettingsService | null;
    requestedModel?: string;
    providerId?: string;
    signal: AbortSignal;
  }) {
    const { settings, signal } = input;
    signal.throwIfAborted();
    const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(
      input.workingDirectory,
      settings,
      '[AgentService]'
    );
    signal.throwIfAborted();
    let useClaudeCodeSystemPrompt = true;
    try {
      useClaudeCodeSystemPrompt = await getUseClaudeCodeSystemPromptSetting(
        input.workingDirectory,
        settings,
        '[AgentService]'
      );
    } catch (error) {
      // Preserve the existing best-effort preset default, not provider/runtime fallback.
      this.logger.error('getUseClaudeCodeSystemPromptSetting failed, defaulting to true', error);
    }
    signal.throwIfAborted();
    const mcpServers = await getMCPServersFromSettings(settings, '[AgentService]');
    signal.throwIfAborted();
    const skills = settings
      ? await getSkillsConfiguration(settings)
      : { enabled: false, sources: [] as Array<'user' | 'project'>, shouldIncludeInTools: false };
    signal.throwIfAborted();
    const subagents = settings
      ? await getSubagentsConfiguration(settings)
      : { enabled: false, sources: [] as Array<'user' | 'project'>, shouldIncludeInTools: false };
    signal.throwIfAborted();
    const agents =
      settings && subagents.enabled
        ? await getCustomSubagents(settings, input.workingDirectory)
        : undefined;
    signal.throwIfAborted();
    const credentials = await settings?.getCredentials();
    signal.throwIfAborted();
    const selection = await this.providers.resolve(input);
    signal.throwIfAborted();
    const maxTurns = await getDefaultMaxTurnsSetting(settings, '[AgentService]');
    signal.throwIfAborted();
    return {
      autoLoadClaudeMd,
      useClaudeCodeSystemPrompt,
      mcpServers,
      skills,
      subagents,
      agents,
      credentials,
      selection,
      maxTurns,
    };
  }

  build(input: {
    configuration: Awaited<ReturnType<AgentQueryOptionsBuilder['configuration']>>;
    workingDirectory: string;
    model?: string;
    session: Pick<ActiveSession, 'model' | 'thinkingLevel' | 'reasoningEffort' | 'sdkSessionId'>;
    thinkingLevel?: ThinkingLevel;
    reasoningEffort?: ReasoningEffort;
    systemPrompt: string;
    abortController: AbortController;
    conversationHistory: ExecuteOptions['conversationHistory'];
  }) {
    input.abortController.signal.throwIfAborted();
    const config = input.configuration;
    const requestedModel = input.model || input.session.model;
    const thinkingLevel = input.thinkingLevel ?? input.session.thinkingLevel;
    const reasoningEffort = input.reasoningEffort ?? input.session.reasoningEffort;
    const mcpServers = Object.keys(config.mcpServers).length ? config.mcpServers : undefined;
    const sdk = createChatOptions({
      cwd: input.workingDirectory,
      validateWorkingDirectory: this.validateDirectory,
      model: config.selection.resolvedModel || input.model,
      sessionModel: config.selection.resolvedModel ? undefined : input.session.model,
      systemPrompt: input.systemPrompt,
      abortController: input.abortController,
      autoLoadClaudeMd: config.autoLoadClaudeMd,
      useClaudeCodeSystemPrompt: config.useClaudeCodeSystemPrompt,
      thinkingLevel,
      maxTurns: config.maxTurns,
      mcpServers,
    });
    const effectiveModel = sdk.model!;
    const { routingModel, bareModel } = this.providers.models(
      config.selection,
      requestedModel,
      effectiveModel
    );
    const sdkSources = (sdk.settingSources ?? []).filter(
      (source): source is 'user' | 'project' => source === 'user' || source === 'project'
    );
    const settingSources = [
      ...new Set([...sdkSources, ...(config.skills.enabled ? config.skills.sources : [])]),
    ];
    const skill = config.skills.shouldIncludeInTools;
    const task =
      config.subagents.shouldIncludeInTools &&
      config.agents &&
      Object.keys(config.agents).length > 0;
    let allowedTools = sdk.allowedTools
      ? [...sdk.allowedTools]
      : skill || task
        ? [...BASE_TOOLS]
        : undefined;
    if (skill && allowedTools?.length && !allowedTools.includes('Skill'))
      allowedTools.push('Skill');
    if (task && allowedTools?.length && !allowedTools.includes('Task')) allowedTools.push('Task');
    allowedTools = this.providers.allowedTools(routingModel, allowedTools, config.selection);
    const options: ExecuteOptions = {
      prompt: '',
      model: bareModel,
      originalModel: effectiveModel,
      cwd: input.workingDirectory,
      systemPrompt: sdk.systemPrompt,
      maxTurns: sdk.maxTurns,
      allowedTools,
      abortController: input.abortController,
      conversationHistory: input.conversationHistory,
      settingSources: settingSources.length ? settingSources : undefined,
      sdkSessionId: input.session.sdkSessionId,
      mcpServers,
      agents: config.agents,
      thinkingLevel,
      reasoningEffort,
      credentials: config.credentials,
      claudeCompatibleProvider: config.selection.provider,
    };
    return { options, effectiveModel, routingModel };
  }
}
