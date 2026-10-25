import { GeminiSetupStatusSchema, type GeminiSetupStatus } from '@automaker/contracts';
import { CopilotSetupStatusSchema, type CopilotSetupStatus } from '@automaker/contracts';
import { CursorSetupStatusSchema, type CursorSetupStatus } from '@automaker/contracts';
import {
  SetupCredentialProviderSchema,
  SetupCredentialTargetResponseSchema,
  SetupCredentialStoreRequestSchema,
  SetupCredentialDeleteRequestSchema,
  SetupCredentialMutationResponseSchema,
} from '@automaker/contracts';
import {
  GithubAuthenticationTargetResponseSchema,
  GithubAuthenticationRequestSchema,
  GithubAuthenticationResponseSchema,
  type GithubAuthenticationRequest,
} from '@automaker/contracts';
import { ProviderInstallGuidanceSchema, type ProviderInstallGuidance } from '@automaker/contracts';
import {
  CodexVerificationTargetResponseSchema,
  CodexVerificationRequestSchema,
  CodexVerificationResponseSchema,
  type CodexVerificationRequest,
} from '@automaker/contracts';
import {
  ClaudeVerificationTargetResponseSchema,
  ClaudeVerificationRequestSchema,
  ClaudeVerificationResponseSchema,
  type ClaudeVerificationRequest,
} from '@automaker/contracts';
import {
  CursorModelConfigTargetSchema,
  CursorModelConfigTargetResponseSchema,
  CursorModelConfigResponseSchema,
  CursorDefaultModelRequestSchema,
  CursorDefaultModelResponseSchema,
  CursorEnabledModelsRequestSchema,
  CursorEnabledModelsResponseSchema,
  type CursorModelConfigTarget,
  type CursorDefaultModelRequest,
  type CursorEnabledModelsRequest,
} from '@automaker/contracts';
import {
  CursorPermissionsTargetSchema,
  CursorPermissionsTargetResponseSchema,
  CursorPermissionsMutationResponseSchema,
  CursorProfileRequestSchema,
  CursorCustomPermissionsRequestSchema,
  CursorDeletePermissionsRequestSchema,
  type CursorPermissionsTarget,
  type CursorProfileRequest,
  type CursorCustomPermissionsRequest,
  type CursorDeletePermissionsRequest,
} from '@automaker/contracts';
import {
  CliConnectionProviderSchema,
  ProviderConnectionTargetResponseSchema,
  ProviderDisconnectRequestSchema,
  ProviderDisconnectResponseSchema,
  ProviderReconnectRequestSchema,
  ProviderReconnectResponseSchema,
  type CliConnectionProvider,
  type ProviderDisconnectRequest,
  type ProviderReconnectRequest,
} from '@automaker/contracts';
import type { HttpDomainTransport } from './transport';
import type { EventCallback } from '../http-api-client';

/** Browser/Electron presentation is supplied by the owning client, not accessed by this domain. */
export interface SetupHostPort {
  confirm(message: string): boolean;
  translate(source: string, values?: Record<string, unknown>): string;
}
export type SetupTransport = Pick<
  HttpDomainTransport,
  'get' | 'post' | 'httpDelete' | 'subscribeToEvent'
>;

export function createSetupClient(transport: SetupTransport, host: SetupHostPort) {
  async function changeSetupCredential(
    operation: 'store' | 'delete',
    provider: string,
    apiKey?: string
  ) {
    const { target } = await setup.getCredentialTarget(provider);
    const request =
      operation === 'store'
        ? SetupCredentialStoreRequestSchema.parse({ confirmed: true, target, apiKey })
        : SetupCredentialDeleteRequestSchema.parse({ confirmed: true, target });
    if (
      !host.confirm(
        host.translate(
          'Change application credentials?\nOperation: {operation}\nProvider: {provider}\nBackend: {directory}\nInstance: {instance}\nPrivate file: {file}\nDeletion disables bootstrap fallback for this application. CLI logins, bootstrap configuration and backups are not removed.',
          {
            operation,
            provider,
            directory: target.workingDirectory,
            instance: target.instanceId,
            file: target.credentialsPath,
          }
        )
      )
    )
      return { success: false, error: host.translate('Credential change cancelled') };
    const preview = await setup.getCredentialTarget(provider);
    if (JSON.stringify(preview.target) !== JSON.stringify(target))
      throw new Error('Credential target changed. Inspect and confirm it again.');
    const result = SetupCredentialMutationResponseSchema.parse(
      operation === 'store'
        ? await transport.post('/api/setup/store-api-key', request)
        : await transport.post('/api/setup/delete-api-key', request)
    );
    if (JSON.stringify(result.target) !== JSON.stringify(target) || result.operation !== operation)
      throw new Error('Credential response does not match confirmation.');
    return result;
  }
  async function preflightCursorModelConfig(input: CursorModelConfigTarget) {
    const target = CursorModelConfigTargetSchema.parse(input);
    const preview = await setup.getCursorModelConfigTarget(target.projectPath);
    if (JSON.stringify(preview.target) !== JSON.stringify(target))
      throw new Error('Cursor model config target changed. Inspect and confirm it again.');
    return target;
  }

  async function preflightCursorPermissions(input: CursorPermissionsTarget) {
    const target = CursorPermissionsTargetSchema.parse(input);
    const preview = await setup.getCursorPermissionsTarget(
      target.scope,
      target.scope === 'project' ? target.projectPath : undefined
    );
    if (JSON.stringify(preview.target) !== JSON.stringify(target))
      throw new Error('Cursor permissions target changed. Inspect and confirm it again.');
    return target;
  }

  function parseCursorPermissionsMutation(value: unknown, target: CursorPermissionsTarget) {
    const response = CursorPermissionsMutationResponseSchema.parse(value);
    if (JSON.stringify(response.target) !== JSON.stringify(target))
      throw new Error('Cursor permissions response target does not match confirmation.');
    return response;
  }

  function parseInstallGuidance(
    provider: 'claude' | 'codex',
    value: unknown
  ): ProviderInstallGuidance {
    const guidance = ProviderInstallGuidanceSchema.parse(value);
    if (guidance.target.provider !== provider)
      throw new Error('CLI installation guidance target does not match provider.');
    return guidance;
  }

  async function disconnectSetupProvider(
    provider: CliConnectionProvider,
    input: ProviderDisconnectRequest
  ) {
    CliConnectionProviderSchema.parse(provider);
    const request = ProviderDisconnectRequestSchema.parse(input);
    if (request.target.provider !== provider)
      throw new Error('Provider connection target does not match provider.');
    await confirmConnectionTarget(provider, request.target);
    const response = ProviderDisconnectResponseSchema.parse(
      await postProviderDisconnect(provider, request)
    );
    if (
      response.target.instanceId !== request.target.instanceId ||
      response.target.workingDirectory !== request.target.workingDirectory ||
      response.target.provider !== provider
    ) {
      throw new Error('Provider disconnect response does not match the confirmed target.');
    }
    return response;
  }

  function postProviderDisconnect(
    provider: CliConnectionProvider,
    request: ProviderDisconnectRequest
  ): Promise<unknown> {
    // Keep the bounded route set explicit for API consumer inventory and review.
    switch (provider) {
      case 'claude':
        return transport.post('/api/setup/deauth-claude', request);
      case 'codex':
        return transport.post('/api/setup/deauth-codex', request);
      case 'cursor':
        return transport.post('/api/setup/deauth-cursor', request);
      case 'gemini':
        return transport.post('/api/setup/deauth-gemini', request);
      case 'copilot':
        return transport.post('/api/setup/deauth-copilot', request);
      case 'opencode':
        return transport.post('/api/setup/deauth-opencode', request);
    }
  }

  async function reconnectSetupProvider(
    provider: CliConnectionProvider,
    input: ProviderReconnectRequest
  ) {
    CliConnectionProviderSchema.parse(provider);
    const request = ProviderReconnectRequestSchema.parse(input);
    if (request.target.provider !== provider)
      throw new Error('Provider connection target does not match provider.');
    await confirmConnectionTarget(provider, request.target);
    const response = ProviderReconnectResponseSchema.parse(
      await postProviderReconnect(provider, request)
    );
    if (
      response.target.instanceId !== request.target.instanceId ||
      response.target.workingDirectory !== request.target.workingDirectory ||
      response.target.provider !== provider
    ) {
      throw new Error('Provider reconnect response does not match the confirmed target.');
    }
    return response;
  }

  async function confirmConnectionTarget(
    provider: CliConnectionProvider,
    target: ProviderDisconnectRequest['target']
  ): Promise<void> {
    // Older connection/auth routes ignored bodies. A typed body alone is not
    // proof that the selected server will enforce the user's approved target.
    const inspected = await setup.getProviderConnectionTarget(provider);
    if (
      inspected.target.instanceId !== target.instanceId ||
      inspected.target.workingDirectory !== target.workingDirectory
    ) {
      throw new Error('Provider connection target changed. Inspect and confirm it again.');
    }
  }

  function postProviderReconnect(
    provider: CliConnectionProvider,
    request: ProviderReconnectRequest
  ): Promise<unknown> {
    switch (provider) {
      case 'claude':
        return transport.post('/api/setup/auth-claude', request);
      case 'codex':
        return transport.post('/api/setup/auth-codex', request);
      case 'cursor':
        return transport.post('/api/setup/auth-cursor', request);
      case 'gemini':
        return transport.post('/api/setup/auth-gemini', request);
      case 'copilot':
        return transport.post('/api/setup/auth-copilot', request);
      case 'opencode':
        return transport.post('/api/setup/auth-opencode', request);
    }
  }

  const setup = {
    reconnectProvider: (provider: CliConnectionProvider, request: ProviderReconnectRequest) =>
      reconnectSetupProvider(provider, request),
    getProviderConnectionTarget: async (provider: CliConnectionProvider) => {
      CliConnectionProviderSchema.parse(provider);
      const response = ProviderConnectionTargetResponseSchema.parse(
        await transport.get(`/api/setup/connection-target?provider=${provider}`)
      );
      if (response.target.provider !== provider)
        throw new Error('Provider connection target does not match provider.');
      return response;
    },
    disconnectProvider: (provider: CliConnectionProvider, request: ProviderDisconnectRequest) =>
      disconnectSetupProvider(provider, request),
    getClaudeStatus: (): Promise<{
      success: boolean;
      status?: string;
      installed?: boolean;
      method?: string;
      version?: string;
      path?: string;
      auth?: {
        authenticated: boolean;
        authenticationChecked?: boolean;
        method: string;
        hasCredentialsFile?: boolean;
        hasToken?: boolean;
        hasStoredOAuthToken?: boolean;
        hasStoredApiKey?: boolean;
        hasEnvApiKey?: boolean;
        hasEnvOAuthToken?: boolean;
        hasCliAuth?: boolean;
        hasRecentActivity?: boolean;
      };
      error?: string;
    }> => transport.get('/api/setup/claude-status'),

    installClaude: async (signal?: AbortSignal): Promise<ProviderInstallGuidance> =>
      parseInstallGuidance(
        'claude',
        await transport.post('/api/setup/install-claude', undefined, signal)
      ),

    authClaude: (
      request: ProviderReconnectRequest
    ): Promise<{
      success: boolean;
      token?: string;
      requiresManualAuth?: boolean;
      terminalOpened?: boolean;
      command?: string;
      error?: string;
      message?: string;
      output?: string;
    }> => reconnectSetupProvider('claude', request),

    deauthClaude: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => disconnectSetupProvider('claude', request),

    getCredentialTarget: async (provider: string) => {
      const name = SetupCredentialProviderSchema.parse(provider);
      const preview = SetupCredentialTargetResponseSchema.parse(
        await transport.get(`/api/setup/credential-target?provider=${name}`)
      );
      if (preview.target.provider !== name)
        throw new Error('Credential target does not match provider.');
      return preview;
    },
    storeApiKey: async (provider: string, apiKey: string) =>
      changeSetupCredential('store', provider, apiKey),

    deleteApiKey: async (provider: string) => changeSetupCredential('delete', provider),

    getApiKeys: (): Promise<{
      success: boolean;
      hasAnthropicKey: boolean;
      hasGoogleKey: boolean;
      hasOpenaiKey: boolean;
    }> => transport.get('/api/setup/api-keys'),

    getPlatform: (): Promise<{
      success: boolean;
      platform: string;
      arch: string;
      homeDir: string;
      isWindows: boolean;
      isMac: boolean;
      isLinux: boolean;
    }> => transport.get('/api/setup/platform'),

    getClaudeVerificationTarget: async (authMethod: 'cli' | 'api_key') => {
      const response = ClaudeVerificationTargetResponseSchema.parse(
        await transport.get(`/api/setup/claude-verification-target?authMethod=${authMethod}`)
      );
      if (response.target.authMethod !== authMethod)
        throw new Error('Claude verification method does not match selection.');
      return response;
    },
    verifyClaudeAuth: async (input: ClaudeVerificationRequest) => {
      const request = ClaudeVerificationRequestSchema.parse(input);
      const preview = await setup.getClaudeVerificationTarget(request.target.authMethod);
      if (JSON.stringify(preview.target) !== JSON.stringify(request.target))
        throw new Error('Claude verification target changed. Inspect and confirm it again.');
      const response = ClaudeVerificationResponseSchema.parse(
        await transport.post('/api/setup/verify-claude-auth', request)
      );
      if (JSON.stringify(response.target) !== JSON.stringify(request.target))
        throw new Error('Claude verification response target does not match confirmation.');
      return response;
    },

    getGhStatus: (): Promise<{
      success: boolean;
      installed: boolean;
      authenticated: boolean;
      authenticationChecked?: boolean;
      version: string | null;
      path: string | null;
      user: string | null;
      error?: string;
    }> => transport.get('/api/setup/gh-status'),

    getGithubAuthenticationTarget: async () =>
      GithubAuthenticationTargetResponseSchema.parse(
        await transport.get('/api/setup/github-authentication-target')
      ),
    verifyGithubAuth: async (input: GithubAuthenticationRequest) => {
      const request = GithubAuthenticationRequestSchema.parse(input);
      const preview = await setup.getGithubAuthenticationTarget();
      if (JSON.stringify(preview.target) !== JSON.stringify(request.target))
        throw new Error('GitHub target changed. Inspect and confirm it again.');
      const response = GithubAuthenticationResponseSchema.parse(
        await transport.post('/api/setup/verify-github-auth', request)
      );
      if (JSON.stringify(response.target) !== JSON.stringify(request.target))
        throw new Error('GitHub response target does not match confirmation.');
      return response;
    },

    // Cursor CLI methods
    getCursorStatus: async (): Promise<CursorSetupStatus> => {
      const result = CursorSetupStatusSchema.safeParse(
        await transport.get('/api/setup/cursor-status')
      );
      if (!result.success) throw new Error('Cursor status protocol is unavailable.');
      return result.data;
    },

    authCursor: (
      request: ProviderReconnectRequest
    ): Promise<{
      success: boolean;
      token?: string;
      requiresManualAuth?: boolean;
      terminalOpened?: boolean;
      command?: string;
      message?: string;
      output?: string;
    }> => reconnectSetupProvider('cursor', request),

    deauthCursor: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => disconnectSetupProvider('cursor', request),

    authOpencode: (
      request: ProviderReconnectRequest
    ): Promise<{
      success: boolean;
      token?: string;
      requiresManualAuth?: boolean;
      terminalOpened?: boolean;
      command?: string;
      message?: string;
      output?: string;
    }> => reconnectSetupProvider('opencode', request),

    deauthOpencode: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => disconnectSetupProvider('opencode', request),

    getCursorConfig: async (projectPath: string) =>
      CursorModelConfigResponseSchema.parse(
        await transport.get(
          `/api/setup/cursor-config?projectPath=${encodeURIComponent(projectPath)}`
        )
      ),

    getCursorModelConfigTarget: async (projectPath: string) =>
      CursorModelConfigTargetResponseSchema.parse(
        await transport.get(
          `/api/setup/cursor-config/target?projectPath=${encodeURIComponent(projectPath)}`
        )
      ),

    setCursorDefaultModel: async (input: CursorDefaultModelRequest) => {
      const request = CursorDefaultModelRequestSchema.parse(input);
      const target = await preflightCursorModelConfig(request.target);
      const result = CursorDefaultModelResponseSchema.parse(
        await transport.post('/api/setup/cursor-config/default-model', request)
      );
      if (
        JSON.stringify(result.target) !== JSON.stringify(target) ||
        result.model !== request.model
      )
        throw new Error('Cursor model config response does not match confirmation.');
      return result;
    },

    setCursorModels: async (input: CursorEnabledModelsRequest) => {
      const request = CursorEnabledModelsRequestSchema.parse(input);
      const target = await preflightCursorModelConfig(request.target);
      const result = CursorEnabledModelsResponseSchema.parse(
        await transport.post('/api/setup/cursor-config/models', request)
      );
      if (
        JSON.stringify(result.target) !== JSON.stringify(target) ||
        JSON.stringify(result.models) !== JSON.stringify(request.models)
      )
        throw new Error('Cursor model config response does not match confirmation.');
      return result;
    },

    // Cursor CLI Permissions
    getCursorPermissions: (
      projectPath?: string
    ): Promise<{
      success: boolean;
      globalPermissions?: { allow: string[]; deny: string[] } | null;
      projectPermissions?: { allow: string[]; deny: string[] } | null;
      effectivePermissions?: { allow: string[]; deny: string[] } | null;
      activeProfile?: 'strict' | 'development' | 'custom' | null;
      hasProjectConfig?: boolean;
      globalTarget?: CursorPermissionsTarget;
      projectTarget?: CursorPermissionsTarget;
      availableProfiles?: Array<{
        id: string;
        name: string;
        description: string;
        permissions: { allow: string[]; deny: string[] };
      }>;
      error?: string;
    }> =>
      transport.get(
        `/api/setup/cursor-permissions${projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : ''}`
      ),

    getCursorPermissionsTarget: async (scope: 'global' | 'project', projectPath?: string) =>
      CursorPermissionsTargetResponseSchema.parse(
        await transport.get(
          `/api/setup/cursor-permissions/target?scope=${scope}${projectPath ? `&projectPath=${encodeURIComponent(projectPath)}` : ''}`
        )
      ),

    applyCursorPermissionProfile: async (input: CursorProfileRequest) => {
      const request = CursorProfileRequestSchema.parse(input);
      const target = await preflightCursorPermissions(request.target);
      return parseCursorPermissionsMutation(
        await transport.post('/api/setup/cursor-permissions/profile', request),
        target
      );
    },

    setCursorCustomPermissions: async (input: CursorCustomPermissionsRequest) => {
      const request = CursorCustomPermissionsRequestSchema.parse(input);
      const target = await preflightCursorPermissions(request.target);
      return parseCursorPermissionsMutation(
        await transport.post('/api/setup/cursor-permissions/custom', request),
        target
      );
    },

    deleteCursorProjectPermissions: async (input: CursorDeletePermissionsRequest) => {
      const request = CursorDeletePermissionsRequestSchema.parse(input);
      const target = await preflightCursorPermissions(request.target);
      return parseCursorPermissionsMutation(
        await transport.httpDelete('/api/setup/cursor-permissions', request),
        target
      );
    },

    getCursorExampleConfig: (
      profileId?: 'strict' | 'development'
    ): Promise<{
      success: boolean;
      profileId?: string;
      config?: string;
      error?: string;
    }> =>
      transport.get(
        `/api/setup/cursor-permissions/example${profileId ? `?profileId=${profileId}` : ''}`
      ),

    // Codex CLI methods
    getCodexStatus: (): Promise<{
      success: boolean;
      status?: string;
      installed?: boolean;
      method?: string;
      version?: string;
      path?: string;
      auth?: {
        authenticated: boolean;
        authenticationChecked?: boolean;
        method: string;
        hasAuthFile?: boolean;
        hasOAuthToken?: boolean;
        hasApiKey?: boolean;
        hasStoredApiKey?: boolean;
        hasEnvApiKey?: boolean;
      };
      error?: string;
    }> => transport.get('/api/setup/codex-status'),

    installCodex: async (signal?: AbortSignal): Promise<ProviderInstallGuidance> =>
      parseInstallGuidance(
        'codex',
        await transport.post('/api/setup/install-codex', undefined, signal)
      ),

    authCodex: (
      request: ProviderReconnectRequest
    ): Promise<{
      success: boolean;
      token?: string;
      requiresManualAuth?: boolean;
      terminalOpened?: boolean;
      command?: string;
      error?: string;
      message?: string;
      output?: string;
    }> => reconnectSetupProvider('codex', request),

    deauthCodex: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => disconnectSetupProvider('codex', request),

    getCodexVerificationTarget: async (authMethod: 'cli' | 'api_key') => {
      const response = CodexVerificationTargetResponseSchema.parse(
        await transport.get(`/api/setup/codex-verification-target?authMethod=${authMethod}`)
      );
      if (response.target.authMethod !== authMethod)
        throw new Error('Codex verification method does not match selection.');
      return response;
    },
    verifyCodexAuth: async (input: CodexVerificationRequest) => {
      const request = CodexVerificationRequestSchema.parse(input);
      const preview = await setup.getCodexVerificationTarget(request.target.authMethod);
      if (JSON.stringify(preview.target) !== JSON.stringify(request.target))
        throw new Error('Codex verification target changed. Inspect and confirm it again.');
      const response = CodexVerificationResponseSchema.parse(
        await transport.post('/api/setup/verify-codex-auth', request)
      );
      if (JSON.stringify(response.target) !== JSON.stringify(request.target))
        throw new Error('Codex verification response target does not match confirmation.');
      return response;
    },

    // OpenCode CLI methods
    getOpencodeStatus: (): Promise<{
      success: boolean;
      status?: string;
      installed?: boolean;
      method?: string;
      version?: string;
      path?: string;
      recommendation?: string;
      installCommands?: {
        macos?: string;
        linux?: string;
        npm?: string;
      };
      auth?: {
        authenticated: boolean;
        authenticationChecked?: boolean;
        method: string;
        hasAuthFile?: boolean;
        hasOAuthToken?: boolean;
        hasApiKey?: boolean;
        hasStoredApiKey?: boolean;
        hasEnvApiKey?: boolean;
      };
      error?: string;
    }> => transport.get('/api/setup/opencode-status'),

    // OpenCode Dynamic Model Discovery
    getOpencodeModels: (
      refresh?: boolean
    ): Promise<{
      success: boolean;
      models?: Array<{
        id: string;
        name: string;
        modelString: string;
        provider: string;
        description: string;
        supportsTools: boolean;
        supportsVision: boolean;
        tier: string;
        default?: boolean;
      }>;
      count?: number;
      cached?: boolean;
      error?: string;
    }> => transport.get(`/api/setup/opencode/models${refresh ? '?refresh=true' : ''}`),

    refreshOpencodeModels: (): Promise<{
      success: boolean;
      models?: Array<{
        id: string;
        name: string;
        modelString: string;
        provider: string;
        description: string;
        supportsTools: boolean;
        supportsVision: boolean;
        tier: string;
        default?: boolean;
      }>;
      count?: number;
      error?: string;
    }> => transport.post('/api/setup/opencode/models/refresh'),

    getOpencodeProviders: (): Promise<{
      success: boolean;
      providers?: Array<{
        id: string;
        name: string;
        authenticated: boolean;
        authMethod?: 'oauth' | 'api_key';
      }>;
      authenticated?: Array<{
        id: string;
        name: string;
        authenticated: boolean;
        authMethod?: 'oauth' | 'api_key';
      }>;
      error?: string;
    }> => transport.get('/api/setup/opencode/providers'),

    clearOpencodeCache: (): Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }> => transport.post('/api/setup/opencode/cache/clear'),

    // Gemini CLI methods
    getGeminiStatus: async (): Promise<GeminiSetupStatus> => {
      const result = GeminiSetupStatusSchema.safeParse(
        await transport.get('/api/setup/gemini-status')
      );
      if (!result.success) throw new Error('Gemini status protocol is unavailable.');
      return result.data;
    },

    authGemini: (
      request: ProviderReconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualAuth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => reconnectSetupProvider('gemini', request),

    deauthGemini: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => disconnectSetupProvider('gemini', request),

    // Copilot SDK methods
    getCopilotStatus: async (): Promise<CopilotSetupStatus> => {
      const result = CopilotSetupStatusSchema.safeParse(
        await transport.get('/api/setup/copilot-status')
      );
      if (!result.success) throw new Error('Copilot status protocol is unavailable.');
      return result.data;
    },

    onInstallProgress: (
      callback: (progress: { cli?: string; data?: string; type?: string }) => void
    ) => {
      return transport.subscribeToEvent('agent:stream', callback as EventCallback);
    },

    onAuthProgress: (
      callback: (progress: { cli?: string; data?: string; type?: string }) => void
    ) => {
      return transport.subscribeToEvent('agent:stream', callback as EventCallback);
    },
  };
  return setup;
}

export type SetupClient = ReturnType<typeof createSetupClient>;
