import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeCompatibleProvider } from '@automaker/types';
import * as helpers from '../../../src/lib/settings-helpers.js';
import * as sdk from '../../../src/lib/sdk-options.js';
import type { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import type { SettingsService } from '../../../src/services/settings-service.js';
import { AgentProviderSelector } from '../../../src/services/agent/agent-provider-selector.js';
import { AgentQueryOptionsBuilder } from '../../../src/services/agent/agent-query-options-builder.js';

vi.mock('../../../src/lib/settings-helpers.js', () => ({
  getAutoLoadClaudeMdSetting: vi.fn(),
  getUseClaudeCodeSystemPromptSetting: vi.fn(),
  getMCPServersFromSettings: vi.fn(),
  getSkillsConfiguration: vi.fn(),
  getSubagentsConfiguration: vi.fn(),
  getCustomSubagents: vi.fn(),
  getDefaultMaxTurnsSetting: vi.fn(),
}));
vi.mock('../../../src/lib/sdk-options.js', () => ({ createChatOptions: vi.fn() }));
const selector = new AgentProviderSelector({} as ProviderRegistry);
const resolve = vi.fn<AgentProviderSelector['resolve']>();
const builder = new AgentQueryOptionsBuilder(selector);
const credentials = { anthropicApiKey: 'fixture-key' };
const getCredentials = vi.fn().mockResolvedValue(credentials);
const settings = { getCredentials } as unknown as SettingsService;
const configurationInput = () => ({
  workingDirectory: '/project',
  settings,
  requestedModel: 'codex-gpt-5.1-codex-max',
  providerId: undefined as string | undefined,
  signal: new AbortController().signal,
});
const sdkOptions = () => ({
  model: 'codex-gpt-5.1-codex-max',
  allowedTools: ['Read', 'Bash'],
  settingSources: ['project', 'local', 'user'] as Array<'project' | 'local' | 'user'>,
  systemPrompt: 'SDK_PROMPT',
  maxTurns: 42,
});
async function buildInput() {
  return {
    configuration: await builder.configuration(configurationInput()),
    workingDirectory: '/project',
    session: {
      model: 'codex-gpt-5.1-codex-max',
      thinkingLevel: 'low' as const,
      reasoningEffort: 'low' as const,
      sdkSessionId: 'existing-sdk-session',
    },
    systemPrompt: 'CONTEXT_AND_BASE',
    abortController: new AbortController(),
    conversationHistory: [{ role: 'user' as const, content: 'Earlier request' }],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(selector, 'resolve').mockImplementation(resolve);
  resolve.mockResolvedValue({});
  getCredentials.mockResolvedValue(credentials);
  vi.mocked(helpers.getAutoLoadClaudeMdSetting).mockResolvedValue(true);
  vi.mocked(helpers.getUseClaudeCodeSystemPromptSetting).mockResolvedValue(false);
  vi.mocked(helpers.getMCPServersFromSettings).mockResolvedValue({});
  vi.mocked(helpers.getSkillsConfiguration).mockResolvedValue({
    enabled: false,
    sources: [],
    shouldIncludeInTools: false,
  });
  vi.mocked(helpers.getSubagentsConfiguration).mockResolvedValue({
    enabled: false,
    sources: [],
    shouldIncludeInTools: false,
  });
  vi.mocked(helpers.getDefaultMaxTurnsSetting).mockResolvedValue(42);
  vi.mocked(sdk.createChatOptions).mockImplementation(() => sdkOptions());
});

describe('AgentQueryOptionsBuilder', () => {
  it('loads project-specific SDK configuration and explicit provider selection without starting an adapter', async () => {
    const input = configurationInput();
    input.providerId = 'endpoint';
    const result = await builder.configuration(input);
    expect(result).toMatchObject({
      autoLoadClaudeMd: true,
      useClaudeCodeSystemPrompt: false,
      credentials,
      maxTurns: 42,
    });
    expect(helpers.getAutoLoadClaudeMdSetting).toHaveBeenCalledWith(
      '/project',
      settings,
      '[AgentService]'
    );
    expect(resolve).toHaveBeenCalledWith(input);
    expect(helpers.getCustomSubagents).not.toHaveBeenCalled();
    expect(sdk.createChatOptions).not.toHaveBeenCalled();
  });
  it('preserves the existing preset default on a failed preset-setting read', async () => {
    vi.mocked(helpers.getUseClaudeCodeSystemPromptSetting).mockRejectedValue(
      new Error('Fixture preset settings unavailable')
    );
    expect((await builder.configuration(configurationInput())).useClaudeCodeSystemPrompt).toBe(
      true
    );
  });
  it('does not swallow credential failure or continue to provider resolution', async () => {
    const failure = new Error('Credentials unavailable');
    getCredentials.mockRejectedValue(failure);
    await expect(builder.configuration(configurationInput())).rejects.toBe(failure);
    expect(resolve).not.toHaveBeenCalled();
    expect(helpers.getDefaultMaxTurnsSetting).not.toHaveBeenCalled();
  });
  it('has explicit no-settings defaults without reading skills/subagent configuration', async () => {
    const result = await builder.configuration({ ...configurationInput(), settings: null });
    expect(result.skills).toEqual({ enabled: false, sources: [], shouldIncludeInTools: false });
    expect(result.agents).toBeUndefined();
    expect(result.credentials).toBeUndefined();
    expect(helpers.getSkillsConfiguration).not.toHaveBeenCalled();
    expect(helpers.getSubagentsConfiguration).not.toHaveBeenCalled();
    expect(getCredentials).not.toHaveBeenCalled();
  });
  it('does not continue configuration reads after cancellation', async () => {
    const input = configurationInput();
    const controller = new AbortController();
    input.signal = controller.signal;
    vi.mocked(helpers.getAutoLoadClaudeMdSetting).mockImplementationOnce(async () => {
      controller.abort();
      return true;
    });
    await expect(builder.configuration(input)).rejects.toMatchObject({ name: 'AbortError' });
    expect(helpers.getUseClaudeCodeSystemPromptSetting).not.toHaveBeenCalled();
    expect(getCredentials).not.toHaveBeenCalled();
    vi.mocked(helpers.getAutoLoadClaudeMdSetting).mockClear();
    await expect(builder.configuration(input)).rejects.toMatchObject({ name: 'AbortError' });
    expect(helpers.getAutoLoadClaudeMdSetting).not.toHaveBeenCalled();
  });
  it('does not read max turns after cancellation during provider resolution', async () => {
    const controller = new AbortController();
    resolve.mockImplementationOnce(async () => {
      controller.abort();
      return {};
    });
    await expect(
      builder.configuration({ ...configurationInput(), signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(helpers.getDefaultMaxTurnsSetting).not.toHaveBeenCalled();
  });
  it('reloads settings/credentials for each message', async () => {
    vi.mocked(helpers.getDefaultMaxTurnsSetting)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20);
    expect((await builder.configuration(configurationInput())).maxTurns).toBe(10);
    expect((await builder.configuration(configurationInput())).maxTurns).toBe(20);
    expect(getCredentials).toHaveBeenCalledTimes(2);
  });
  it('retains original routing ID, bare API ID, SDK session, history and stored reasoning defaults', async () => {
    const input = await buildInput();
    const result = builder.build(input);
    expect(result.routingModel).toBe('codex-gpt-5.1-codex-max');
    expect(result.options).toMatchObject({
      model: 'gpt-5.1-codex-max',
      originalModel: 'codex-gpt-5.1-codex-max',
      cwd: '/project',
      systemPrompt: 'SDK_PROMPT',
      maxTurns: 42,
      thinkingLevel: 'low',
      reasoningEffort: 'low',
      sdkSessionId: 'existing-sdk-session',
      conversationHistory: input.conversationHistory,
      credentials,
      settingSources: ['project', 'user'],
    });
    expect(result.options.abortController).toBe(input.abortController);
    expect(result.options.mcpServers).toBeUndefined();
    expect(sdk.createChatOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'CONTEXT_AND_BASE',
        sessionModel: input.session.model,
        autoLoadClaudeMd: true,
        useClaudeCodeSystemPrompt: false,
        maxTurns: 42,
      })
    );
  });
  it('uses custom mapped model only for SDK configuration, never for API routing', async () => {
    const provider = { id: 'custom' } as ClaudeCompatibleProvider;
    resolve.mockResolvedValue({ provider, resolvedModel: 'claude-opus-4-6' });
    vi.mocked(sdk.createChatOptions).mockReturnValue({ ...sdkOptions(), model: 'claude-opus-4-6' });
    const input = await buildInput();
    const result = builder.build({ ...input, model: 'GLM-4.7' });
    expect(sdk.createChatOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6', sessionModel: undefined })
    );
    expect(result.routingModel).toBe('GLM-4.7');
    expect(result.options).toMatchObject({
      model: 'GLM-4.7',
      originalModel: 'claude-opus-4-6',
      claudeCompatibleProvider: provider,
    });
  });
  it('uses request thinking/reasoning settings over persisted session settings', async () => {
    const result = builder.build({
      ...(await buildInput()),
      thinkingLevel: 'high',
      reasoningEffort: 'xhigh',
    });
    expect(result.options.thinkingLevel).toBe('high');
    expect(result.options.reasoningEffort).toBe('xhigh');
    expect(sdk.createChatOptions).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'high' })
    );
  });
  it('merges sources and adds enabled Skill/Task tools without mutating SDK arrays', async () => {
    vi.mocked(helpers.getSkillsConfiguration).mockResolvedValue({
      enabled: true,
      sources: ['project', 'user'],
      shouldIncludeInTools: true,
    });
    vi.mocked(helpers.getSubagentsConfiguration).mockResolvedValue({
      enabled: true,
      sources: ['project'],
      shouldIncludeInTools: true,
    });
    const agents = { planner: { description: 'Plan', prompt: 'Plan carefully' } };
    vi.mocked(helpers.getCustomSubagents).mockResolvedValue(agents);
    const base = { ...sdkOptions(), allowedTools: ['Read', 'Skill'] };
    vi.mocked(sdk.createChatOptions).mockReturnValue(base);
    const result = builder.build(await buildInput());
    expect(result.options.allowedTools).toEqual(['Read', 'Skill', 'Task']);
    expect(result.options.settingSources).toEqual(['project', 'user']);
    expect(result.options.agents).toEqual(agents);
    expect(base.allowedTools).toEqual(['Read', 'Skill']);
    expect(base.settingSources).toEqual(['project', 'local', 'user']);
    expect(helpers.getCustomSubagents).toHaveBeenCalledWith(settings, '/project');
  });
  it('does not advertise Task when enabled subagents have no definitions', async () => {
    vi.mocked(helpers.getSubagentsConfiguration).mockResolvedValue({
      enabled: true,
      sources: ['project'],
      shouldIncludeInTools: true,
    });
    vi.mocked(helpers.getCustomSubagents).mockResolvedValue({});
    expect(builder.build(await buildInput()).options.allowedTools).not.toContain('Task');
  });
  it('retains the default base tools when an SDK omits its list and Skill is enabled', async () => {
    vi.mocked(sdk.createChatOptions).mockReturnValue({ ...sdkOptions(), allowedTools: undefined });
    vi.mocked(helpers.getSkillsConfiguration).mockResolvedValue({
      enabled: true,
      sources: ['user'],
      shouldIncludeInTools: true,
    });
    const tools = builder.build(await buildInput()).options.allowedTools;
    expect(tools).toEqual(expect.arrayContaining(['Read', 'Write', 'Bash', 'Skill']));
    expect(tools).not.toContain('Task');
  });
  it('omits empty tool/source/MCP overrides instead of manufacturing restrictions', async () => {
    vi.mocked(sdk.createChatOptions).mockReturnValue({
      ...sdkOptions(),
      allowedTools: undefined,
      settingSources: [],
    });
    const result = builder.build(await buildInput());
    expect(result.options.allowedTools).toBeUndefined();
    expect(result.options.settingSources).toBeUndefined();
    expect(result.options.mcpServers).toBeUndefined();
  });
  it('passes configured MCP servers to SDK and provider options', async () => {
    const mcpServers = { fixture: { command: 'fixture-mcp', args: ['--test'] } };
    vi.mocked(helpers.getMCPServersFromSettings).mockResolvedValue(mcpServers);
    const result = builder.build(await buildInput());
    expect(result.options.mcpServers).toEqual(mcpServers);
    expect(sdk.createChatOptions).toHaveBeenCalledWith(expect.objectContaining({ mcpServers }));
  });
  it('does not build SDK options for an already-cancelled run', async () => {
    const input = await buildInput();
    input.abortController.abort();
    expect(() => builder.build(input)).toThrow();
    expect(sdk.createChatOptions).not.toHaveBeenCalled();
  });
});
