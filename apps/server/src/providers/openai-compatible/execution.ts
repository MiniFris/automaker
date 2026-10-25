import path from 'node:path';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { SSHExecutionEnvironment } from '../../services/execution-environment/ssh.js';
import {
  ManagedDocker,
  DockerExecutionEnvironment,
} from '../../services/execution-environment/docker.js';
import {
  ExecutionEnvironmentError,
  issueEnvironment,
  isIssuedEnvironment,
} from '../../services/execution-environment/runtime.js';
import type { ExistingEnvironmentPreparation } from '../../services/execution-environment/bindings.js';
import {
  isDirectModel,
  providerModelTimeouts,
  getModelProvider,
  type DirectAgentSettings,
  type ExecuteOptions,
  type ModelTimeoutSettings,
} from '@automaker/types';
import type { SettingsService } from '../../services/settings-service.js';
import { resolveOpenAICompatibleConnection } from './config.js';
import { toolPolicy, ToolRegistry } from './tool-registry.js';
import { ReadOnlyWorkspace, type WorkspaceAccessPolicy } from './workspace.js';
import { agentLimits } from './agent-loop.js';
import { AgentCheckpointStore, type AgentCheckpointRepository } from './checkpoint.js';
import { OpenAICompatibleError } from './errors.js';
import { EnvironmentBindingStore } from '../../services/execution-environment/bindings.js';
import { type ExecutionEnvironment } from '../../services/execution-environment/runtime.js';
import { boundRuntime } from '../../services/execution-environment/bound-runtime.js';
import { captureNativeLocalEnvironment } from '../../services/execution-environment/local.js';
import { prepareCliExecution } from '../environment-execution.js';

/** The existing-only capability verifies a running container; it never starts one. */
class ExistingOnlyDockerManager extends ManagedDocker {
  override async start(
    binding: import('@automaker/types').DockerProjectBinding,
    signal?: AbortSignal
  ): Promise<void> {
    const container = await this.verify(binding, signal);
    if (!container.State.Running)
      throw new ExecutionEnvironmentError(
        'DOCKER_NOT_RUNNING',
        'Existing analysis container is stopped. No start was attempted.'
      );
  }
}

/** Opaque server-resolved analysis grant, never a request/runtime-shaped permission. */
export interface ExistingExecutionPreparation {
  readonly kind: 'existing-analysis-target';
}
interface ExistingPreparationAuthority {
  settings: SettingsService;
  requested: string;
  projectPath: string;
  cwd: string;
  runKey: string;
  runtime: ExecutionEnvironment;
  preparation: ExistingEnvironmentPreparation;
}
const existingPreparations = new WeakMap<
  ExistingExecutionPreparation,
  ExistingPreparationAuthority
>();
export async function resolveExistingExecutionPreparation(
  settings: SettingsService,
  requested: string,
  runKey: string,
  signal: AbortSignal,
  hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
): Promise<ExistingExecutionPreparation> {
  const environment = captureNativeLocalEnvironment(hostEnvironment);
  signal.throwIfAborted();
  const resolver = new ProjectGitService(settings, undefined, undefined, environment);
  const target = await resolver.resolveOrLocal(requested);
  const store = new EnvironmentBindingStore(settings, undefined, undefined, environment);
  const state = await store.configuration(target.environment.projectPath);
  const current = await resolver.resolveOrLocal(requested);
  signal.throwIfAborted();
  if (current.environment.targetId !== target.environment.targetId)
    throw new OpenAICompatibleError('The inspected analysis target changed.');
  const descriptor =
    target.runtime instanceof SSHExecutionEnvironment ||
    target.runtime instanceof DockerExecutionEnvironment
      ? target.runtime.binding
      : null;
  const dockerManager =
    target.runtime instanceof DockerExecutionEnvironment
      ? new ExistingOnlyDockerManager(settings)
      : undefined;
  const runtime = issueEnvironment(
    dockerManager && descriptor
      ? new DockerExecutionEnvironment(
          dockerManager,
          (target.runtime as DockerExecutionEnvironment).binding,
          target.runtime.cwd
        )
      : target.runtime
  );
  const token: ExistingExecutionPreparation = Object.freeze({ kind: 'existing-analysis-target' });
  existingPreparations.set(token, {
    settings,
    requested: path.resolve(requested),
    projectPath: target.environment.projectPath,
    cwd: target.binding?.cwd ?? target.environment.path,
    runKey,
    runtime,
    preparation: {
      runtime,
      dockerManager,
      binding: target.binding,
      selectionFingerprint: JSON.stringify({ resolved: state.resolved, explicit: state.explicit }),
      descriptorFingerprint: JSON.stringify(descriptor),
    },
  });
  return token;
}

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

function applyTimeoutLimits(
  policy: DirectAgentSettings,
  timeouts?: ModelTimeoutSettings
): DirectAgentSettings {
  if (timeouts?.agentTimeoutMs === undefined && timeouts?.toolTimeoutMs === undefined)
    return policy;
  return {
    ...policy,
    limits: {
      ...policy.limits,
      ...(timeouts.agentTimeoutMs !== undefined && { maxDurationMs: timeouts.agentTimeoutMs }),
      ...(timeouts.toolTimeoutMs !== undefined && { toolTimeoutMs: timeouts.toolTimeoutMs }),
    },
  };
}

/** Bind agent providers to trusted runtime settings; Direct also resolves its explicit endpoint. */
export async function prepareDirectExecution(
  options: ExecuteOptions,
  settings: SettingsService | null | undefined,
  selection: {
    model: string;
    providerId?: string;
    projectPath?: string;
    runKey?: string;
    feature?: { targetBranch?: string | null };
  },
  mode: 'text' | 'agent' = 'agent',
  hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
  checkpointRepository?: AgentCheckpointRepository,
  existingPreparation?: ExistingExecutionPreparation
): Promise<ExecuteOptions> {
  const authority = existingPreparation ? existingPreparations.get(existingPreparation) : undefined;
  if (
    existingPreparation &&
    (!authority ||
      authority.settings !== settings ||
      authority.requested !== path.resolve(options.cwd) ||
      authority.runKey !== selection.runKey ||
      !isIssuedEnvironment(authority.runtime))
  )
    throw new OpenAICompatibleError('Invalid existing analysis execution grant.');
  if (authority) {
    options = { ...options, cwd: authority.cwd };
    selection = { ...selection, projectPath: authority.projectPath };
  }
  const environmentSnapshot = captureNativeLocalEnvironment(hostEnvironment);
  const global = settings ? await settings.getGlobalSettings() : undefined;
  const modelTimeouts = providerModelTimeouts(global, getModelProvider(selection.model));
  if (settings) options = { ...options, modelTimeouts };
  if (!isDirectModel(selection.model))
    return mode === 'text'
      ? options
      : authority
        ? prepareCliExecution(
            options,
            settings,
            selection,
            environmentSnapshot,
            authority.preparation
          )
        : prepareCliExecution(options, settings, selection, environmentSnapshot);
  if (!settings || typeof selection.providerId !== 'string' || !selection.providerId)
    throw new OpenAICompatibleError(
      'Direct models require an explicit configured endpoint providerId.'
    );
  const credentials = await settings.getCredentials();
  const connection = resolveOpenAICompatibleConnection({
    endpoints: global!.openaiCompatibleEndpoints,
    modelTimeouts,
    credentials,
    model: selection.model,
    providerId: selection.providerId,
  });
  let policy = parseDirectAgentSettings(global!.openaiCompatibleAgentSettings ?? {});
  let binding: import('@automaker/types').ExecutionEnvironmentBinding | undefined;
  let environment: ExecutionEnvironment | undefined;
  if (mode === 'agent' && options.tools?.length !== 0 && connection.model.capabilities.tools) {
    try {
      const pinned = await new EnvironmentBindingStore(
        settings,
        authority?.preparation.dockerManager,
        undefined,
        environmentSnapshot
      ).bind({
        cwd: options.cwd,
        projectPath: selection.projectPath ?? options.cwd,
        key: selection.runKey,
        legacySettings: policy,
        signal: options.abortController?.signal,
        sshFeature: selection.feature,
        feature: selection.feature,
        ...(authority && {
          existingOnly: true,
          existingTarget: authority.preparation,
          existingId: authority.preparation.binding?.id,
        }),
      });
      binding = pinned.binding;
      if (binding.type !== 'legacy') {
        environment =
          authority?.runtime ?? (await boundRuntime(binding, settings, environmentSnapshot));
        if (
          authority &&
          (environment.type !== binding.type ||
            environment.cwd !== (binding.runtimeCwd ?? binding.cwd))
        )
          throw new OpenAICompatibleError(
            'Existing analysis runtime does not match its saved binding.'
          );
        // Legacy permission flags do not control an explicitly confirmed Local environment.
        policy = {
          access: 'read-only',
          limits: {
            ...policy.limits,
            toolTimeoutMs: policy.limits?.toolTimeoutMs ?? 180_000,
            maxDurationMs: policy.limits?.maxDurationMs ?? 900_000,
          },
        };
      } else policy = parseDirectAgentSettings(pinned.legacySettings ?? {});
    } catch (error) {
      throw new OpenAICompatibleError(
        error instanceof Error ? error.message : 'Execution environment is unavailable.'
      );
    }
  }
  // Explicit endpoint values win, then global model timeouts, then existing agent limits/defaults.
  policy = applyTimeoutLimits(policy, connection.timeouts);
  // Internal text helpers do not need access to local tools or runtime configuration.
  if (mode === 'text') policy.access = 'read-only';
  const store = checkpointRepository ?? new AgentCheckpointStore(settings.getDataDirectory());
  return {
    ...options,
    ...(binding?.runtimeCwd && { cwd: environment!.cwd }),
    executionEnvironmentRuntime: environment,
    executionEnvironmentBinding: binding,
    model: connection.model.id,
    originalModel: selection.model,
    openaiCompatibleConnection: connection,
    openaiCompatibleAgent: { ...policy, onCheckpoint: (snapshot) => store.save(snapshot) },
    // CLI defaults (10,000 turns / Claude presets / SDK session / MCP) do not apply here.
    maxTurns: Math.min(100, options.maxTurns ?? 12),
    systemPrompt:
      [
        environment?.type === 'ssh'
          ? `Execution environment: SSH on a remote Linux host, not a sandbox. The authoritative working directory is ${environment.cwd}. All tool paths and commands refer to that remote host; the local Automaker project directory is control-plane metadata only. Read applicable project instructions (CLAUDE.md, AGENTS.md, etc.) from this remote working copy before making changes. Local project context files are not automatically injected. Do not assume a synchronized local copy or automatically push Git changes.`
          : '',
        typeof options.systemPrompt === 'object'
          ? options.systemPrompt.append
          : options.systemPrompt,
      ]
        .filter(Boolean)
        .join('\n\n') || undefined,
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

/** Automatic tests use the same pinned environment as the Direct feature, never an implicit host fallback. */
export async function runDirectShellCommand(
  settings: SettingsService | null | undefined,
  cwd: string,
  command: string,
  abortSignal: AbortSignal,
  context?: { projectPath: string; runKey: string },
  hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
  workspaceAccess?: WorkspaceAccessPolicy
): Promise<{ exitCode: number; output: string; truncated: boolean }> {
  if (!settings)
    throw new OpenAICompatibleError(
      'Direct pipeline tests require server execution-environment settings.'
    );
  const environmentSnapshot = captureNativeLocalEnvironment(hostEnvironment);
  const global = await settings.getGlobalSettings();
  const timeouts = providerModelTimeouts(global, 'openai-compatible');
  let policy = parseDirectAgentSettings(global.openaiCompatibleAgentSettings ?? {});
  const pinned = await new EnvironmentBindingStore(
    settings,
    undefined,
    undefined,
    environmentSnapshot
  ).bind({
    cwd,
    projectPath: context?.projectPath ?? cwd,
    key: context?.runKey,
    legacySettings: policy,
    signal: abortSignal,
  });
  if (pinned.binding.type !== 'legacy') {
    const environment = await boundRuntime(pinned.binding, settings, environmentSnapshot);
    return environment.exec(command, abortSignal, {
      timeoutMs: Math.min(
        timeouts.toolTimeoutMs ?? policy.limits?.toolTimeoutMs ?? 180_000,
        timeouts.agentTimeoutMs ?? policy.limits?.maxDurationMs ?? 900_000
      ),
    });
  }
  policy = applyTimeoutLimits(parseDirectAgentSettings(pinned.legacySettings ?? {}), timeouts);
  if (!policy.shell)
    throw new OpenAICompatibleError(
      'Direct pipeline tests require a pinned local Docker image. Host execution is disabled.'
    );
  const limits = agentLimits(policy.limits, undefined);
  const signal = AbortSignal.any([
    abortSignal,
    AbortSignal.timeout(Math.min(limits.toolTimeoutMs, limits.maxDurationMs)),
  ]);
  const workspace = await ReadOnlyWorkspace.create(cwd, signal, workspaceAccess);
  const name = policy.shell.executable === 'pwsh' ? 'PowerShell' : 'Bash';
  const registry = new ToolRegistry(workspace, [name], policy.access === 'read-only', policy);
  // Await cooperative cleanup before returning an interrupted test result.
  const response = await registry.execute(
    {
      id: 'pipeline-test',
      type: 'function',
      function: { name, arguments: JSON.stringify({ command }) },
    },
    signal
  );
  const parsed = JSON.parse(response.content) as {
    ok: boolean;
    result?: { exitCode: number; output: string; truncated: boolean };
    error?: { message: string };
  };
  if (
    !parsed.ok ||
    !parsed.result ||
    !Number.isInteger(parsed.result.exitCode) ||
    typeof parsed.result.output !== 'string'
  )
    throw new OpenAICompatibleError(
      parsed.error?.message ?? 'Sandbox test result was unavailable or truncated.'
    );
  return parsed.result;
}
