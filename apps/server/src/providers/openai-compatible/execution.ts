import { isDirectModel, type DirectAgentSettings, type ExecuteOptions } from '@automaker/types';
import type { SettingsService } from '../../services/settings-service.js';
import { resolveOpenAICompatibleConnection } from './config.js';
import { toolPolicy, ToolRegistry } from './tool-registry.js';
import { ReadOnlyWorkspace } from './workspace.js';
import { agentLimits } from './agent-loop.js';
import { AgentCheckpointStore } from './checkpoint.js';
import { OpenAICompatibleError } from './errors.js';

/** Persistable controls only: no callbacks, connections, checkpoints or arbitrary tool names. */
export function parseDirectAgentSettings(input: unknown): DirectAgentSettings {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['access', 'shell', 'limits'].includes(key))
  )
    throw new OpenAICompatibleError('Invalid direct agent settings.');
  const settings = input as DirectAgentSettings;
  const policy = toolPolicy(settings);
  agentLimits(settings.limits, undefined);
  return { ...policy, ...(settings.limits && { limits: { ...settings.limits } }) };
}

/** Resolve only from trusted settings, per request. Never infer an endpoint by model name. */
export async function prepareDirectExecution(
  options: ExecuteOptions,
  settings: SettingsService | null | undefined,
  selection: { model: string; providerId?: string },
  mode: 'text' | 'agent' = 'agent'
): Promise<ExecuteOptions> {
  if (!isDirectModel(selection.model)) return options;
  if (!settings || typeof selection.providerId !== 'string' || !selection.providerId)
    throw new OpenAICompatibleError(
      'Direct models require an explicit configured endpoint providerId.'
    );
  const [global, credentials] = await Promise.all([
    settings.getGlobalSettings(),
    settings.getCredentials(),
  ]);
  const connection = resolveOpenAICompatibleConnection({
    endpoints: global.openaiCompatibleEndpoints,
    credentials,
    model: selection.model,
    providerId: selection.providerId,
  });
  const policy = parseDirectAgentSettings(global.openaiCompatibleAgentSettings ?? {});
  // Internal text helpers do not need access to local tools or runtime configuration.
  if (mode === 'text') policy.access = 'read-only';
  const store = new AgentCheckpointStore(settings.getDataDirectory());
  return {
    ...options,
    model: connection.model.id,
    originalModel: selection.model,
    openaiCompatibleConnection: connection,
    openaiCompatibleAgent: { ...policy, onCheckpoint: (snapshot) => store.save(snapshot) },
    // CLI defaults (10,000 turns / Claude presets / SDK session / MCP) do not apply here.
    maxTurns: Math.min(100, options.maxTurns ?? 12),
    systemPrompt:
      typeof options.systemPrompt === 'object' ? options.systemPrompt.append : options.systemPrompt,
    tools: mode === 'text' || !connection.model.capabilities.tools ? [] : options.tools,
    sdkSessionId: undefined,
    settingSources: undefined,
    mcpServers: undefined,
    agents: undefined,
    claudeApiProfile: undefined,
    claudeCompatibleProvider: undefined,
    credentials: undefined,
  };
}

/** Automatic tests of model-edited code must not escape via the legacy host test runner. */
export async function runDirectShellCommand(
  settings: SettingsService | null | undefined,
  cwd: string,
  command: string,
  abortSignal: AbortSignal
): Promise<{ exitCode: number; output: string; truncated: boolean }> {
  if (!settings) throw new OpenAICompatibleError('Direct pipeline tests require configured Docker sandbox settings.');
  const global = await settings.getGlobalSettings();
  const policy = parseDirectAgentSettings(global.openaiCompatibleAgentSettings ?? {});
  if (!policy.shell) throw new OpenAICompatibleError('Direct pipeline tests require a pinned local Docker image. Host execution is disabled.');
  const limits = agentLimits(policy.limits, undefined);
  const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(Math.min(limits.toolTimeoutMs, limits.maxDurationMs))]);
  const workspace = await ReadOnlyWorkspace.create(cwd, signal);
  const name = policy.shell.executable === 'pwsh' ? 'PowerShell' : 'Bash';
  const registry = new ToolRegistry(workspace, [name], policy.access === 'read-only', policy);
  // Await cooperative cleanup before returning an interrupted test result.
  const response = await registry.execute({ id: 'pipeline-test', type: 'function', function: { name, arguments: JSON.stringify({ command }) } }, signal);
  const parsed = JSON.parse(response.content) as { ok: boolean; result?: { exitCode: number; output: string; truncated: boolean }; error?: { message: string } };
  if (!parsed.ok || !parsed.result || !Number.isInteger(parsed.result.exitCode) || typeof parsed.result.output !== 'string')
    throw new OpenAICompatibleError(parsed.error?.message ?? 'Sandbox test result was unavailable or truncated.');
  return parsed.result;
}
