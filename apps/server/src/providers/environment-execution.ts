import {
  isCursorModel,
  isGeminiModel,
  isRemoteCliModel,
  isRemoteSdkModel,
  isClaudeModel,
  isCopilotModel,
  isCodexModel,
  type ExecuteOptions,
} from '@automaker/types';
import type { SettingsService } from '../services/settings-service.js';
import {
  type ExistingEnvironmentPreparation,
  EnvironmentBindingStore,
} from '../services/execution-environment/bindings.js';
import {
  ExecutionEnvironmentError,
  isIssuedEnvironment,
} from '../services/execution-environment/runtime.js';
import { captureNativeLocalEnvironment } from '../services/execution-environment/local.js';
import { boundRuntime } from '../services/execution-environment/bound-runtime.js';

/** Never interpret a client-shaped object as permission to run a host process. */
export function remoteCliRuntime(options: ExecuteOptions) {
  const runtime = options.executionEnvironmentRuntime;
  if (runtime !== undefined && !isIssuedEnvironment(runtime))
    throw new ExecutionEnvironmentError(
      'INVALID_RUNTIME',
      'Provider runtime was not issued by the server.'
    );
  if (isIssuedEnvironment(runtime) && runtime.type !== 'local') {
    if (!runtime.runProcess)
      throw new ExecutionEnvironmentError(
        'PROCESS_UNSUPPORTED',
        'The selected runtime cannot stream CLI processes.'
      );
    return runtime;
  }
  if (['ssh', 'docker'].includes(options.executionEnvironmentBinding?.type ?? ''))
    throw new ExecutionEnvironmentError(
      'INVALID_RUNTIME',
      'Remote binding has no issued runtime. Host execution was refused.'
    );
  return undefined;
}

export async function hasRemoteEnvironment(
  settings: SettingsService,
  projectPath: string,
  runKey: string,
  hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env
) {
  const environmentSnapshot = captureNativeLocalEnvironment(hostEnvironment);
  const store = new EnvironmentBindingStore(settings, undefined, undefined, environmentSnapshot);
  const pinned = await store.peek(projectPath, runKey);
  return ['ssh', 'docker', 'auto'].includes(
    pinned?.type ?? (await store.configuration(projectPath)).resolved.type
  );
}

export async function prepareCliExecution(
  options: ExecuteOptions,
  settings: SettingsService | null | undefined,
  selection: {
    model: string;
    projectPath?: string;
    runKey?: string;
    feature?: { targetBranch?: string | null };
  },
  hostEnvironment: Readonly<NodeJS.ProcessEnv> = process.env,
  existingPreparation?: ExistingEnvironmentPreparation
): Promise<ExecuteOptions> {
  if (!settings) return options;
  const environmentSnapshot = captureNativeLocalEnvironment(hostEnvironment);
  const store = new EnvironmentBindingStore(
    settings,
    existingPreparation?.dockerManager,
    undefined,
    environmentSnapshot
  );
  const projectPath = selection.projectPath ?? options.cwd;
  const pinned =
    existingPreparation?.binding ??
    (selection.runKey ? await store.peek(projectPath, selection.runKey) : undefined);
  const state = await store.configuration(projectPath);
  if (!existingPreparation && !pinned && !state.explicit) return options; // Preserve unconfigured legacy installations.
  const type = pinned?.type ?? state.resolved.type;
  const remote = ['ssh', 'docker', 'auto'].includes(type);
  if (remote && !isRemoteCliModel(selection.model) && !isRemoteSdkModel(selection.model))
    throw new ExecutionEnvironmentError(
      'PROVIDER_RUNTIME_UNSUPPORTED',
      'Claude, Codex and Copilot SDK runtime adapters are not implemented yet. Select Local explicitly or use Direct, Cursor, Gemini or OpenCode. No host fallback was performed.'
    );
  if (remote) {
    const sdk = isRemoteSdkModel(selection.model);
    const claude = sdk && isClaudeModel(selection.model);
    if (options.tools?.length === 0 && !claude && !isGeminiModel(selection.model))
      throw new ExecutionEnvironmentError(
        'REMOTE_PROVIDER_READ_ONLY_UNSUPPORTED',
        'Remote CLI tool-free execution is not enforced yet. Use Direct for tools: []. No CLI was started.'
      );
    if (
      Object.keys(options.mcpServers ?? {}).length ||
      options.agents ||
      options.claudeApiProfile ||
      options.claudeCompatibleProvider
    )
      throw new ExecutionEnvironmentError(
        'REMOTE_PROVIDER_CONFIG_UNSUPPORTED',
        'Controller MCP, subagents and Claude connection profiles cannot be forwarded to remote CLI. Configure authentication and integrations inside the selected environment.'
      );
    if (Array.isArray(options.prompt) && options.prompt.some((block) => block.type !== 'text'))
      throw new ExecutionEnvironmentError(
        'REMOTE_PROVIDER_INPUT_UNSUPPORTED',
        'Remote CLI attachments are not implemented. Use a text prompt.'
      );
    if (
      options.readOnly &&
      !isCursorModel(selection.model) &&
      (!sdk || isCopilotModel(selection.model))
    )
      throw new ExecutionEnvironmentError(
        'REMOTE_PROVIDER_READ_ONLY_UNSUPPORTED',
        'This provider cannot enforce remote read-only planning yet. Use Direct, Cursor, Claude or Codex. No process was started.'
      );
  }
  const { binding } = await store.bind({
    projectPath,
    cwd: options.cwd,
    key: selection.runKey,
    legacySettings: {},
    signal: options.abortController?.signal,
    sshFeature: selection.feature,
    feature: selection.feature,
    ...(existingPreparation && {
      existingOnly: true,
      existingTarget: existingPreparation,
      existingId: existingPreparation.binding?.id,
    }),
  });
  const environment =
    binding.type === 'legacy'
      ? undefined
      : (existingPreparation?.runtime ??
        (await boundRuntime(binding, settings, environmentSnapshot)));
  if (
    existingPreparation &&
    environment &&
    (!isIssuedEnvironment(environment) ||
      environment.type !== binding.type ||
      environment.cwd !== (binding.runtimeCwd ?? binding.cwd))
  )
    throw new ExecutionEnvironmentError(
      'INVALID_RUNTIME',
      'Existing analysis runtime does not match the saved binding.'
    );
  const codexDefaults =
    remote && isCodexModel(selection.model) ? await settings.getGlobalSettings() : undefined;
  return {
    ...options,
    executionEnvironmentBinding: binding,
    executionEnvironmentRuntime: environment,
    ...(binding.runtimeCwd && { cwd: environment!.cwd }),
    ...(codexDefaults && {
      codexSettings: {
        ...options.codexSettings,
        sandboxMode:
          options.codexSettings?.sandboxMode ?? codexDefaults.codexSandboxMode ?? 'workspace-write',
        enableWebSearch:
          options.codexSettings?.enableWebSearch ?? codexDefaults.codexEnableWebSearch ?? false,
      },
    }),
    ...(binding.type === 'ssh' && {
      cwd: environment!.cwd,
      systemPrompt: [
        `The authoritative project is on SSH at ${environment!.cwd}. All CLI tools execute on the remote host. Read project instructions there. The controller project path is metadata only; there is no background sync or automatic push.`,
        typeof options.systemPrompt === 'object'
          ? options.systemPrompt.append
          : options.systemPrompt,
      ]
        .filter(Boolean)
        .join('\n\n'),
    }),
    ...(remote && { credentials: undefined }),
  };
}
