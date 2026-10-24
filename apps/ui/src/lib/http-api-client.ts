import { createWorktreeClient } from './http-domains/worktree';
import { createModelClient } from './http-domains/model';
import { createZaiClient } from './http-domains/zai';
import { createFeaturesClient } from './http-domains/features';
import { createAutoModeClient } from './http-domains/autoMode';
import { createEnhancePromptClient } from './http-domains/enhancePrompt';
import { createGitClient } from './http-domains/git';
import { createSpecRegenerationClient } from './http-domains/specRegeneration';
import { createRunningAgentsClient } from './http-domains/runningAgents';
import { createGithubClient } from './http-domains/github';
import { createWorkspaceClient } from './http-domains/workspace';
import { createAgentClient } from './http-domains/agent';
import { createTemplatesClient } from './http-domains/templates';
import { createSettingsClient } from './http-domains/settings';
import { createExecutionEnvironmentsClient } from './http-domains/executionEnvironments';
import { createModelTimeoutsClient } from './http-domains/modelTimeouts';
import { createDirectEndpointsClient } from './http-domains/directEndpoints';
import { createSessionsClient } from './http-domains/sessions';
import { createClaudeClient } from './http-domains/claude';
import { createCodexClient } from './http-domains/codex';
import { createGeminiClient } from './http-domains/gemini';
import { createContextClient } from './http-domains/context';
import { createBacklogPlanClient } from './http-domains/backlogPlan';
import { createIdeationClient } from './http-domains/ideation';
import { createNotificationsClient } from './http-domains/notifications';
import { createEventHistoryClient } from './http-domains/eventHistory';
import { createMcpClient } from './http-domains/mcp';
import { createPipelineClient } from './http-domains/pipeline';
/**
 * HTTP API Client for web mode
 *
 * This client provides the same API as the Electron IPC bridge,
 * but communicates with the backend server via HTTP/WebSocket.
 */

import { createLogger } from '@automaker/utils/logger';
import { translate } from './i18n';
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
import type { ProjectGitEnvironment, DevServerEnvironmentMetadata } from '@automaker/types';
import type {
  ElectronAPI,
  FileResult,
  WriteResult,
  ReaddirResult,
  StatResult,
  DialogResult,
  SaveImageResult,
  AutoModeAPI,
  FeaturesAPI,
  SpecRegenerationAPI,
  GitHubAPI,
  IdeationAPI,
  NotificationsAPI,
  EventHistoryAPI,
} from './electron';
import type { Notification } from '@automaker/types';
import type { WorktreeAPI, GitAPI } from '@/types/electron';
import type { Feature } from '@automaker/types';
import { getGlobalFileBrowser } from '@/contexts/file-browser-context';

const logger = createLogger('HttpClient');
const NO_STORE_CACHE_MODE: RequestCache = 'no-store';

// Cached server URL (set during initialization in Electron mode)
let cachedServerUrl: string | null = null;

/**
 * Notify the UI that the current session is no longer valid.
 * Used to redirect the user to a logged-out route on 401/403 responses.
 */
const notifyLoggedOut = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('automaker:logged-out'));
  } catch {
    // Ignore - navigation will still be handled by failed requests in most cases
  }
};

/**
 * Handle an unauthorized response in cookie/session auth flows.
 * Clears in-memory token and attempts to clear the cookie (best-effort),
 * then notifies the UI to redirect.
 */
const handleUnauthorized = (): void => {
  clearSessionToken();
  // Best-effort cookie clear (avoid throwing)
  fetch(`${getServerUrl()}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: '{}',
    cache: NO_STORE_CACHE_MODE,
  }).catch(() => {});
  notifyLoggedOut();
};

/**
 * Notify the UI that the server is offline/unreachable.
 * Used to redirect the user to the login page which will show server unavailable.
 */
const notifyServerOffline = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('automaker:server-offline'));
  } catch {
    // Ignore
  }
};

/**
 * Check if an error is a connection error (server offline/unreachable).
 * These are typically TypeError with 'Failed to fetch' or similar network errors.
 */
export const isConnectionError = (error: unknown): boolean => {
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return (
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('connection refused')
    );
  }
  // Check for error objects with message property
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message).toLowerCase();
    return (
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('connection refused')
    );
  }
  return false;
};

/**
 * Handle a server offline error by verifying the server is actually down
 * before redirecting to login. Uses debouncing to coalesce rapid errors
 * and a health check to confirm the server isn't just experiencing a
 * transient network blip.
 */
let serverOfflineCheckPending = false;

export const handleServerOffline = (): void => {
  // Debounce: if a check is already in progress, skip
  if (serverOfflineCheckPending) return;
  serverOfflineCheckPending = true;

  // Wait briefly to let transient errors settle, then verify with a health check
  setTimeout(() => {
    (async () => {
      try {
        const response = await fetch(`${getServerUrl()}/api/health`, {
          method: 'GET',
          cache: NO_STORE_CACHE_MODE,
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          logger.info('Server health check passed, ignoring transient connection error');
          return;
        }
      } catch {
        // Health check failed - server is genuinely offline
      }

      logger.error('Server appears to be offline, redirecting to login...');
      notifyServerOffline();
    })().finally(() => {
      serverOfflineCheckPending = false;
    });
  }, 2000);
};

/**
 * Initialize server URL from Electron IPC.
 * Must be called early in Electron mode before making API requests.
 */
export const initServerUrl = async (): Promise<void> => {
  const electron = typeof window !== 'undefined' ? window.electronAPI : null;
  if (electron?.getServerUrl) {
    try {
      cachedServerUrl = await electron.getServerUrl();
      logger.info('Server URL from Electron:', cachedServerUrl);
    } catch (error) {
      logger.warn('Failed to get server URL from Electron:', error);
    }
  }
};

// Server URL - uses cached value from IPC or environment variable
const getServerUrl = (): string => {
  // Use cached URL from Electron IPC if available
  if (cachedServerUrl) {
    return cachedServerUrl;
  }

  if (typeof window !== 'undefined') {
    const envUrl = import.meta.env.VITE_SERVER_URL;
    if (envUrl) return envUrl;

    // In web mode (not Electron), use relative URL to leverage Vite proxy
    // This avoids CORS issues since requests appear same-origin
    if (!window.isElectron) {
      return '';
    }
  }
  // Use VITE_HOSTNAME if set, otherwise default to localhost
  const hostname = import.meta.env.VITE_HOSTNAME || 'localhost';
  return `http://${hostname}:3008`;
};

/**
 * Get the server URL (exported for use in other modules)
 */
export const getServerUrlSync = (): string => getServerUrl();

// Cached API key for authentication (Electron mode only)
let cachedApiKey: string | null = null;
let apiKeyInitialized = false;
let apiKeyInitPromise: Promise<void> | null = null;

// Cached session token for authentication (Web mode - explicit header auth)
// Persisted to localStorage to survive page reloads
let cachedSessionToken: string | null = null;
const SESSION_TOKEN_KEY = 'automaker:sessionToken';

// Initialize cached session token from localStorage on module load
// This ensures web mode survives page reloads with valid authentication
const initSessionToken = (): void => {
  if (typeof window === 'undefined') return; // Skip in SSR
  try {
    cachedSessionToken = window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    // localStorage might be disabled or unavailable
    cachedSessionToken = null;
  }
};

// Initialize on module load
initSessionToken();

// Get API key for Electron mode (returns cached value after initialization)
// Exported for use in WebSocket connections that need auth
export const getApiKey = (): string | null => cachedApiKey;

/**
 * Wait for API key initialization to complete.
 * Returns immediately if already initialized.
 */
export const waitForApiKeyInit = (): Promise<void> => {
  if (apiKeyInitialized) return Promise.resolve();
  if (apiKeyInitPromise) return apiKeyInitPromise;
  // If not started yet, start it now
  return initApiKey();
};

// Get session token for Web mode (returns cached value after login)
export const getSessionToken = (): string | null => cachedSessionToken;

// Set session token (called after login) - persists to localStorage for page reload survival
export const setSessionToken = (token: string | null): void => {
  cachedSessionToken = token;
  if (typeof window === 'undefined') return; // Skip in SSR
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // localStorage might be disabled; continue with in-memory cache
  }
};

// Clear session token (called on logout)
export const clearSessionToken = (): void => {
  cachedSessionToken = null;
  if (typeof window === 'undefined') return; // Skip in SSR
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // localStorage might be disabled
  }
};

/**
 * Check if we're running in Electron mode
 */
export const isElectronMode = (): boolean => {
  if (typeof window === 'undefined') return false;

  // Prefer a stable runtime marker from preload.
  // In some dev/electron setups, method availability can be temporarily undefined
  // during early startup, but `isElectron` remains reliable.
  const api = window.electronAPI;
  return api?.isElectron === true || !!api?.getApiKey;
};

// Cached external server mode flag
let cachedExternalServerMode: boolean | null = null;

/**
 * Check if running in external server mode (Docker API)
 * In this mode, Electron uses session-based auth like web mode
 */
export const checkExternalServerMode = async (): Promise<boolean> => {
  if (cachedExternalServerMode !== null) {
    return cachedExternalServerMode;
  }

  if (typeof window !== 'undefined') {
    const api = window.electronAPI;
    if (api?.isExternalServerMode) {
      try {
        cachedExternalServerMode = Boolean(await api.isExternalServerMode());
        return cachedExternalServerMode;
      } catch (error) {
        logger.warn('Failed to check external server mode:', error);
      }
    }
  }

  cachedExternalServerMode = false;
  return false;
};

/**
 * Get cached external server mode (synchronous, returns null if not yet checked)
 */
export const isExternalServerMode = (): boolean | null => cachedExternalServerMode;

/**
 * Initialize API key and server URL for Electron mode authentication.
 * In web mode, authentication uses HTTP-only cookies instead.
 *
 * This should be called early in app initialization.
 */
export const initApiKey = async (): Promise<void> => {
  // Return existing promise if already in progress
  if (apiKeyInitPromise) return apiKeyInitPromise;

  // Return immediately if already initialized
  if (apiKeyInitialized) return;

  // Create and store the promise so concurrent calls wait for the same initialization
  apiKeyInitPromise = (async () => {
    try {
      // Initialize server URL from Electron IPC first (needed for API requests)
      await initServerUrl();

      // Only Electron mode uses API key header auth
      if (typeof window !== 'undefined' && window.electronAPI?.getApiKey) {
        try {
          cachedApiKey = await window.electronAPI.getApiKey();
          if (cachedApiKey) {
            logger.info('Using API key from Electron');
            return;
          }
        } catch (error) {
          logger.warn('Failed to get API key from Electron:', error);
        }
      }

      // In web mode, authentication is handled via HTTP-only cookies
      logger.info('Web mode - using cookie-based authentication');
    } finally {
      // Mark as initialized after completion, regardless of success or failure
      apiKeyInitialized = true;
    }
  })();

  return apiKeyInitPromise;
};

/**
 * Check authentication status with the server
 */
export const checkAuthStatus = async (): Promise<{
  authenticated: boolean;
  required: boolean;
}> => {
  try {
    const response = await fetch(`${getServerUrl()}/api/auth/status`, {
      credentials: 'include',
      headers: getApiKey() ? { 'X-API-Key': getApiKey()! } : undefined,
      cache: NO_STORE_CACHE_MODE,
    });
    const data = await response.json();
    return {
      authenticated: data.authenticated ?? false,
      required: data.required ?? true,
    };
  } catch (error) {
    logger.error('Failed to check auth status:', error);
    return { authenticated: false, required: true };
  }
};

/**
 * Login with API key (for web mode)
 * After login succeeds, verifies the session is actually working by making
 * a request to an authenticated endpoint.
 */
export const login = async (
  apiKey: string
): Promise<{ success: boolean; error?: string; token?: string }> => {
  try {
    const response = await fetch(`${getServerUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ apiKey }),
      cache: NO_STORE_CACHE_MODE,
    });
    const data = await response.json();

    // Store the session token if login succeeded
    if (data.success && data.token) {
      setSessionToken(data.token);
      logger.info('Session token stored after login');

      // Verify the session is actually working by making a request to an authenticated endpoint
      const verified = await verifySession();
      if (!verified) {
        logger.error('Login appeared successful but session verification failed');
        return {
          success: false,
          error: 'Session verification failed. Please try again.',
        };
      }
      logger.info('Login verified successfully');
    }

    return data;
  } catch (error) {
    logger.error('Login failed:', error);
    return { success: false, error: 'Network error' };
  }
};

/**
 * Check if the session cookie is still valid by making a request to an authenticated endpoint.
 * Note: This does NOT retrieve the session token - on page refresh we rely on cookies alone.
 * The session token is only available after a fresh login.
 */
export const fetchSessionToken = async (): Promise<boolean> => {
  // On page refresh, we can't retrieve the session token (it's stored in HTTP-only cookie).
  // We just verify the cookie is valid by checking auth status.
  // The session token is only stored in memory after a fresh login.
  try {
    const response = await fetch(`${getServerUrl()}/api/auth/status`, {
      credentials: 'include', // Send the session cookie
      cache: NO_STORE_CACHE_MODE,
    });

    if (!response.ok) {
      logger.info('Failed to check auth status');
      return false;
    }

    const data = await response.json();
    if (data.success && data.authenticated) {
      logger.info('Session cookie is valid');
      return true;
    }

    logger.info('Session cookie is not authenticated');
    return false;
  } catch (error) {
    logger.error('Failed to check session:', error);
    return false;
  }
};

/**
 * Logout (for web mode)
 */
export const logout = async (): Promise<{ success: boolean }> => {
  try {
    const response = await fetch(`${getServerUrl()}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: NO_STORE_CACHE_MODE,
    });

    // Clear the cached session token
    clearSessionToken();
    logger.info('Session token cleared on logout');

    return await response.json();
  } catch (error) {
    logger.error('Logout failed:', error);
    return { success: false };
  }
};

/**
 * Verify that the current session is still valid by making a request to an authenticated endpoint.
 * If the session has expired or is invalid, clears the session and returns false.
 * This should be called:
 * 1. After login to verify the cookie was set correctly
 * 2. On app load to verify the session hasn't expired
 *
 * Returns:
 * - true: Session is valid
 * - false: Session is definitively invalid (401/403 auth failure)
 * - throws: Network error or server not ready (caller should retry)
 */
export const verifySession = async (): Promise<boolean> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Electron mode: use API key header
  const apiKey = getApiKey();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  // Add session token header if available (web mode)
  const sessionToken = getSessionToken();
  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken;
  }

  // Make a request to an authenticated endpoint to verify the session
  // We use /api/settings/status as it requires authentication and is lightweight
  // Note: fetch throws on network errors, which we intentionally let propagate
  const response = await fetch(`${getServerUrl()}/api/settings/status`, {
    headers,
    credentials: 'include',
    cache: NO_STORE_CACHE_MODE,
    // Avoid hanging indefinitely during backend reloads or network issues
    signal: AbortSignal.timeout(2500),
  });

  // Check for authentication errors - these are definitive "invalid session" responses
  if (response.status === 401 || response.status === 403) {
    logger.warn('Session verification failed - session expired or invalid');
    // Clear the in-memory/localStorage session token since it's no longer valid
    // Note: We do NOT call logout here - that would destroy a potentially valid
    // cookie if the issue was transient (e.g., token not sent due to timing)
    clearSessionToken();
    return false;
  }

  // For other non-ok responses (5xx, etc.), throw to trigger retry
  if (!response.ok) {
    const error = new Error(`Session verification failed with status: ${response.status}`);
    logger.warn('Session verification failed with status:', response.status);
    throw error;
  }

  logger.info('Session verified successfully');
  return true;
};

/**
 * Check if the server is running in a containerized (sandbox) environment.
 * This endpoint is unauthenticated so it can be checked before login.
 */
export const checkSandboxEnvironment = async (): Promise<{
  isContainerized: boolean;
  skipSandboxWarning?: boolean;
  error?: string;
}> => {
  try {
    const response = await fetch(`${getServerUrl()}/api/health/environment`, {
      method: 'GET',
      cache: NO_STORE_CACHE_MODE,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn('Failed to check sandbox environment');
      return { isContainerized: false, error: 'Failed to check environment' };
    }

    const data = await response.json();
    return {
      isContainerized: data.isContainerized ?? false,
      skipSandboxWarning: data.skipSandboxWarning ?? false,
    };
  } catch (error) {
    logger.error('Sandbox environment check failed:', error);
    return { isContainerized: false, error: 'Network error' };
  }
};

export type EventType =
  | 'agent:stream'
  | 'auto-mode:event'
  | 'spec-regeneration:event'
  | 'issue-validation:event'
  | 'backlog-plan:event'
  | 'ideation:stream'
  | 'ideation:analysis'
  | 'worktree:init-started'
  | 'worktree:init-output'
  | 'worktree:init-completed'
  | 'dev-server:starting'
  | 'dev-server:started'
  | 'dev-server:output'
  | 'dev-server:stopped'
  | 'dev-server:url-detected'
  | 'test-runner:started'
  | 'test-runner:output'
  | 'test-runner:completed'
  | 'notification:created';

/**
 * Dev server log event payloads for WebSocket streaming
 */

/** Shared base for dev server events that carry URL/port information */
interface DevServerUrlEvent extends DevServerEnvironmentMetadata {
  worktreePath: string;
  url: string;
  port: number;
  timestamp: string;
}

export interface DevServerStartingEvent extends DevServerEnvironmentMetadata {
  worktreePath: string;
  timestamp: string;
}

export type DevServerStartedEvent = DevServerUrlEvent;

export interface DevServerOutputEvent {
  sessionId?: string;
  worktreePath: string;
  content: string;
  timestamp: string;
}

export interface DevServerStoppedEvent extends DevServerEnvironmentMetadata {
  worktreePath: string;
  port: number;
  exitCode: number | null;
  error?: string;
  timestamp: string;
}

export type DevServerUrlDetectedEvent = DevServerUrlEvent;

export type DevServerLogEvent =
  | { type: 'dev-server:starting'; payload: DevServerStartingEvent }
  | { type: 'dev-server:started'; payload: DevServerStartedEvent }
  | { type: 'dev-server:output'; payload: DevServerOutputEvent }
  | { type: 'dev-server:stopped'; payload: DevServerStoppedEvent }
  | { type: 'dev-server:url-detected'; payload: DevServerUrlDetectedEvent };

/**
 * Test runner event payloads for WebSocket streaming
 */
export type TestRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'cancelled' | 'error';

export interface TestRunnerStartedEvent {
  executionEnvironment?: ProjectGitEnvironment;
  sessionId: string;
  worktreePath: string;
  /** The test command being run (from project settings) */
  command: string;
  testFile?: string;
  timestamp: string;
}

export interface TestRunnerOutputEvent {
  sessionId: string;
  worktreePath: string;
  content: string;
  timestamp: string;
}

export interface TestRunnerCompletedEvent {
  executionEnvironment?: ProjectGitEnvironment;
  error?: string;
  sessionId: string;
  worktreePath: string;
  /** The test command that was run */
  command: string;
  status: TestRunStatus;
  testFile?: string;
  exitCode: number | null;
  duration: number;
  timestamp: string;
}

export type TestRunnerEvent =
  | { type: 'test-runner:started'; payload: TestRunnerStartedEvent }
  | { type: 'test-runner:output'; payload: TestRunnerOutputEvent }
  | { type: 'test-runner:completed'; payload: TestRunnerCompletedEvent };

/**
 * Response type for fetching dev server logs
 */
export interface DevServerLogsResponse {
  success: boolean;
  result?: DevServerEnvironmentMetadata & {
    worktreePath: string;
    port: number;
    url: string;
    logs: string;
    startedAt: string;
  };
  error?: string;
}

/**
 * Response type for fetching test logs
 */
export interface TestLogsResponse {
  success: boolean;
  result?: {
    executionEnvironment?: ProjectGitEnvironment;
    error?: string;
    sessionId: string;
    worktreePath: string;
    /** The test command that was/is being run */
    command: string;
    status: TestRunStatus;
    testFile?: string;
    logs: string;
    startedAt: string;
    finishedAt: string | null;
    exitCode: number | null;
  };
  error?: string;
}

export type EventCallback = (payload: unknown) => void;

export interface EnhancePromptResult {
  success: boolean;
  enhancedText?: string;
  error?: string;
}

/**
 * HTTP API Client that implements ElectronAPI interface
 */
export class HttpApiClient implements ElectronAPI {
  private async changeSetupCredential(
    operation: 'store' | 'delete',
    provider: string,
    apiKey?: string
  ) {
    const { target } = await this.setup.getCredentialTarget(provider);
    const request =
      operation === 'store'
        ? SetupCredentialStoreRequestSchema.parse({ confirmed: true, target, apiKey })
        : SetupCredentialDeleteRequestSchema.parse({ confirmed: true, target });
    if (
      !window.confirm(
        translate(
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
      return { success: false, error: translate('Credential change cancelled') };
    const preview = await this.setup.getCredentialTarget(provider);
    if (JSON.stringify(preview.target) !== JSON.stringify(target))
      throw new Error('Credential target changed. Inspect and confirm it again.');
    const result = SetupCredentialMutationResponseSchema.parse(
      operation === 'store'
        ? await this.post('/api/setup/store-api-key', request)
        : await this.post('/api/setup/delete-api-key', request)
    );
    if (JSON.stringify(result.target) !== JSON.stringify(target) || result.operation !== operation)
      throw new Error('Credential response does not match confirmation.');
    return result;
  }
  private serverUrl: string;
  private ws: WebSocket | null = null;
  private eventCallbacks: Map<EventType, Set<EventCallback>> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  /** Consecutive reconnect failure count for exponential backoff */
  private reconnectAttempts = 0;
  /** Visibility change handler reference for cleanup */
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    this.serverUrl = getServerUrl();
    // Electron mode: connect WebSocket immediately once API key is ready.
    // Web mode: defer WebSocket connection until a consumer subscribes to events,
    // to avoid noisy 401s on first-load/login/setup routes.
    if (isElectronMode()) {
      waitForApiKeyInit()
        .then(() => {
          this.connectWebSocket();
        })
        .catch((error) => {
          logger.error('API key initialization failed:', error);
          // Still attempt WebSocket connection - it may work with cookie auth
          this.connectWebSocket();
        });
    }

    // OPTIMIZATION: Reconnect WebSocket immediately when tab becomes visible
    // This eliminates the reconnection delay after tab discard/background
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        // If WebSocket is disconnected, reconnect immediately
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          logger.info('Tab became visible - attempting immediate WebSocket reconnect');
          // Clear any pending reconnect timer
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.reconnectAttempts = 0; // Reset backoff on visibility change
          // Use silent mode: a 401 during visibility-change reconnect should NOT
          // trigger a full logout cascade. The session is verified separately via
          // verifySession() in __root.tsx's fast-hydrate path.
          this.connectWebSocket({ silent: true });
        }
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  /**
   * Fetch a short-lived WebSocket token from the server.
   * Used for secure WebSocket authentication without exposing session tokens in URLs.
   *
   * @param options.silent - When true, a 401/403 will NOT trigger handleUnauthorized().
   *   Use this for background reconnections (e.g., visibility-change) where a transient
   *   auth failure should not force a full logout cascade. The actual session validity
   *   is verified separately via verifySession() in the fast-hydrate path.
   */
  private async fetchWsToken(options?: { silent?: boolean }): Promise<string | null> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add session token header if available
      const sessionToken = getSessionToken();
      if (sessionToken) {
        headers['X-Session-Token'] = sessionToken;
      }

      const response = await fetch(`${this.serverUrl}/api/auth/token`, {
        headers,
        credentials: 'include',
        cache: NO_STORE_CACHE_MODE,
      });

      if (response.status === 401 || response.status === 403) {
        if (options?.silent) {
          logger.debug('fetchWsToken: 401/403 during silent reconnect — skipping logout');
        } else {
          handleUnauthorized();
        }
        return null;
      }

      if (!response.ok) {
        logger.warn('Failed to fetch wsToken:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.success && data.token) {
        return data.token;
      }

      return null;
    } catch (error) {
      logger.error('Error fetching wsToken:', error);
      return null;
    }
  }

  private connectWebSocket(options?: { silent?: boolean }): void {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;

    // Wait for API key initialization to complete before attempting connection
    // This prevents race conditions during app startup
    waitForApiKeyInit()
      .then(() => this.doConnectWebSocketInternal(options))
      .catch((error) => {
        logger.error('Failed to initialize for WebSocket connection:', error);
        this.isConnecting = false;
      });
  }

  private doConnectWebSocketInternal(options?: { silent?: boolean }): void {
    // Electron mode typically authenticates with the injected API key.
    // However, in external-server/cookie-auth flows, the API key may be unavailable.
    // In that case, fall back to the same wsToken/cookie authentication used in web mode
    // so the UI still receives real-time events (running tasks, logs, etc.).
    if (isElectronMode()) {
      const apiKey = getApiKey();
      if (!apiKey) {
        logger.warn('Electron mode: API key missing, attempting wsToken/cookie auth for WebSocket');
        this.fetchWsToken(options)
          .then((wsToken) => {
            const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/api/events';
            if (wsToken) {
              this.establishWebSocket(`${wsUrl}?wsToken=${encodeURIComponent(wsToken)}`);
            } else {
              // Fallback: try connecting without token (will fail if not authenticated)
              logger.warn('No wsToken available, attempting WebSocket connection anyway');
              this.establishWebSocket(wsUrl);
            }
          })
          .catch((error) => {
            logger.error('Failed to prepare WebSocket connection (electron fallback):', error);
            this.isConnecting = false;
          });
        return;
      }

      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/api/events';
      this.establishWebSocket(`${wsUrl}?apiKey=${encodeURIComponent(apiKey)}`);
      return;
    }

    // In web mode, fetch a short-lived wsToken first
    this.fetchWsToken(options)
      .then((wsToken) => {
        const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/api/events';
        if (wsToken) {
          this.establishWebSocket(`${wsUrl}?wsToken=${encodeURIComponent(wsToken)}`);
        } else {
          // Fallback: try connecting without token (will fail if not authenticated)
          logger.warn('No wsToken available, attempting connection anyway');
          this.establishWebSocket(wsUrl);
        }
      })
      .catch((error) => {
        logger.error('Failed to prepare WebSocket connection:', error);
        this.isConnecting = false;
      });
  }

  /**
   * Establish the actual WebSocket connection
   */
  private establishWebSocket(wsUrl: string): void {
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        logger.info('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0; // Reset backoff on successful connection
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Only log non-high-frequency events to avoid progressive memory growth
          // from accumulated console entries. High-frequency events (dev-server output,
          // test runner output, agent progress) fire 10+ times/sec and would generate
          // thousands of console entries per minute.
          const isHighFrequency =
            data.type === 'dev-server:output' ||
            data.type === 'test-runner:output' ||
            data.type === 'feature:progress' ||
            (data.type === 'auto-mode:event' && data.payload?.type === 'auto_mode_progress');
          if (!isHighFrequency) {
            logger.info('WebSocket message:', data.type);
          }
          const callbacks = this.eventCallbacks.get(data.type);
          if (callbacks) {
            callbacks.forEach((cb) => cb(data.payload));
          }
        } catch (error) {
          logger.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = () => {
        logger.info('WebSocket disconnected');
        this.isConnecting = false;
        this.ws = null;

        // OPTIMIZATION: Exponential backoff instead of fixed 5-second delay
        // First attempt: immediate (0ms), then 500ms → 1s → 2s → 5s max
        if (!this.reconnectTimer) {
          const backoffDelays = [0, 500, 1000, 2000, 5000];
          const delayMs =
            backoffDelays[Math.min(this.reconnectAttempts, backoffDelays.length - 1)] ?? 5000;
          this.reconnectAttempts++;

          if (delayMs === 0) {
            // Immediate reconnect on first attempt
            this.connectWebSocket();
          } else {
            logger.info(
              `WebSocket reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempts})`
            );
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              this.connectWebSocket();
            }, delayMs);
          }
        }
      };

      this.ws.onerror = (error) => {
        logger.error('WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      logger.error('Failed to create WebSocket:', error);
      this.isConnecting = false;
    }
  }

  private subscribeToEvent(type: EventType, callback: EventCallback): () => void {
    if (!this.eventCallbacks.has(type)) {
      this.eventCallbacks.set(type, new Set());
    }
    this.eventCallbacks.get(type)!.add(callback);

    // Ensure WebSocket is connected
    this.connectWebSocket();

    return () => {
      const callbacks = this.eventCallbacks.get(type);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Electron mode: use API key
    const apiKey = getApiKey();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      return headers;
    }

    // Web mode: use session token if available
    const sessionToken = getSessionToken();
    if (sessionToken) {
      headers['X-Session-Token'] = sessionToken;
    }

    return headers;
  }

  private async preflightCursorModelConfig(input: CursorModelConfigTarget) {
    const target = CursorModelConfigTargetSchema.parse(input);
    const preview = await this.setup.getCursorModelConfigTarget(target.projectPath);
    if (JSON.stringify(preview.target) !== JSON.stringify(target))
      throw new Error('Cursor model config target changed. Inspect and confirm it again.');
    return target;
  }

  private async preflightCursorPermissions(input: CursorPermissionsTarget) {
    const target = CursorPermissionsTargetSchema.parse(input);
    const preview = await this.setup.getCursorPermissionsTarget(
      target.scope,
      target.scope === 'project' ? target.projectPath : undefined
    );
    if (JSON.stringify(preview.target) !== JSON.stringify(target))
      throw new Error('Cursor permissions target changed. Inspect and confirm it again.');
    return target;
  }

  private parseCursorPermissionsMutation(value: unknown, target: CursorPermissionsTarget) {
    const response = CursorPermissionsMutationResponseSchema.parse(value);
    if (JSON.stringify(response.target) !== JSON.stringify(target))
      throw new Error('Cursor permissions response target does not match confirmation.');
    return response;
  }

  private parseInstallGuidance(
    provider: 'claude' | 'codex',
    value: unknown
  ): ProviderInstallGuidance {
    const guidance = ProviderInstallGuidanceSchema.parse(value);
    if (guidance.target.provider !== provider)
      throw new Error('CLI installation guidance target does not match provider.');
    return guidance;
  }

  private async disconnectSetupProvider(
    provider: CliConnectionProvider,
    input: ProviderDisconnectRequest
  ) {
    CliConnectionProviderSchema.parse(provider);
    const request = ProviderDisconnectRequestSchema.parse(input);
    if (request.target.provider !== provider)
      throw new Error('Provider connection target does not match provider.');
    await this.confirmConnectionTarget(provider, request.target);
    const response = ProviderDisconnectResponseSchema.parse(
      await this.postProviderDisconnect(provider, request)
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

  private postProviderDisconnect(
    provider: CliConnectionProvider,
    request: ProviderDisconnectRequest
  ): Promise<unknown> {
    // Keep the bounded route set explicit for API consumer inventory and review.
    switch (provider) {
      case 'claude':
        return this.post('/api/setup/deauth-claude', request);
      case 'codex':
        return this.post('/api/setup/deauth-codex', request);
      case 'cursor':
        return this.post('/api/setup/deauth-cursor', request);
      case 'gemini':
        return this.post('/api/setup/deauth-gemini', request);
      case 'copilot':
        return this.post('/api/setup/deauth-copilot', request);
      case 'opencode':
        return this.post('/api/setup/deauth-opencode', request);
    }
  }

  private async reconnectSetupProvider(
    provider: CliConnectionProvider,
    input: ProviderReconnectRequest
  ) {
    CliConnectionProviderSchema.parse(provider);
    const request = ProviderReconnectRequestSchema.parse(input);
    if (request.target.provider !== provider)
      throw new Error('Provider connection target does not match provider.');
    await this.confirmConnectionTarget(provider, request.target);
    const response = ProviderReconnectResponseSchema.parse(
      await this.postProviderReconnect(provider, request)
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

  private async confirmConnectionTarget(
    provider: CliConnectionProvider,
    target: ProviderDisconnectRequest['target']
  ): Promise<void> {
    // Older connection/auth routes ignored bodies. A typed body alone is not
    // proof that the selected server will enforce the user's approved target.
    const inspected = await this.setup.getProviderConnectionTarget(provider);
    if (
      inspected.target.instanceId !== target.instanceId ||
      inspected.target.workingDirectory !== target.workingDirectory
    ) {
      throw new Error('Provider connection target changed. Inspect and confirm it again.');
    }
  }

  private postProviderReconnect(
    provider: CliConnectionProvider,
    request: ProviderReconnectRequest
  ): Promise<unknown> {
    switch (provider) {
      case 'claude':
        return this.post('/api/setup/auth-claude', request);
      case 'codex':
        return this.post('/api/setup/auth-codex', request);
      case 'cursor':
        return this.post('/api/setup/auth-cursor', request);
      case 'gemini':
        return this.post('/api/setup/auth-gemini', request);
      case 'copilot':
        return this.post('/api/setup/auth-copilot', request);
      case 'opencode':
        return this.post('/api/setup/auth-opencode', request);
    }
  }

  private async post<T>(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    // Ensure API key is initialized before making request
    await waitForApiKeyInit();
    let requestBody = body;
    if (
      (endpoint.startsWith('/api/git/') || endpoint.startsWith('/api/worktree/')) &&
      body &&
      typeof body === 'object'
    ) {
      const source = body as Record<string, unknown>;
      const alias = source.worktreePath ?? source.projectPath;
      const target = typeof alias === 'string' ? this.gitEnvironmentTargets.get(alias) : undefined;
      if (target && source.environmentTargetId === undefined)
        requestBody = { ...source, environmentTargetId: target };
    }
    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include', // Include cookies for session auth
      body: requestBody ? JSON.stringify(requestBody) : undefined,
      signal,
    });

    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let forbiddenDomain = false;
      try {
        const errorData = await response.json();
        forbiddenDomain = errorData.errorCode === 'FORBIDDEN';
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // If parsing JSON fails, use status text
      }
      if (response.status === 403 && !forbiddenDomain) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    if (endpoint.startsWith('/api/git/') || endpoint.startsWith('/api/worktree/')) {
      const remember = (value: unknown) => {
        const environment = value as { path?: unknown; targetId?: unknown } | undefined;
        if (typeof environment?.path === 'string' && environment.targetId === '')
          this.gitEnvironmentTargets.delete(environment.path);
        if (
          typeof environment?.path === 'string' &&
          typeof environment.targetId === 'string' &&
          /^[a-f0-9]{64}$/.test(environment.targetId)
        )
          this.gitEnvironmentTargets.set(environment.path, environment.targetId);
      };
      remember(data?.executionEnvironment);
      if (Array.isArray(data?.worktrees))
        for (const item of data.worktrees) remember(item.executionEnvironment);
    }
    return data;
  }

  private readonly gitEnvironmentTargets = new Map<string, string>();

  async get<T>(endpoint: string): Promise<T> {
    // Ensure API key is initialized before making request
    await waitForApiKeyInit();
    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      headers: this.getHeaders(),
      credentials: 'include', // Include cookies for session auth
      cache: NO_STORE_CACHE_MODE,
    });

    if (response.status === 401 || response.status === 403) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // If parsing JSON fails, use status text
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    // Ensure API key is initialized before making request
    await waitForApiKeyInit();
    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      credentials: 'include', // Include cookies for session auth
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401 || response.status === 403) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // If parsing JSON fails, use status text
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  private async httpDelete<T>(endpoint: string, body?: unknown): Promise<T> {
    // Ensure API key is initialized before making request
    await waitForApiKeyInit();
    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      credentials: 'include', // Include cookies for session auth
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401 || response.status === 403) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // If parsing JSON fails, use status text
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  // Basic operations
  async ping(): Promise<string> {
    const result = await this.get<{ status: string }>('/api/health');
    return result.status === 'ok' ? 'pong' : 'error';
  }

  async openExternalLink(url: string): Promise<{ success: boolean; error?: string }> {
    // Open in new tab
    window.open(url, '_blank', 'noopener,noreferrer');
    return { success: true };
  }

  async openInEditor(
    filePath: string,
    line?: number,
    column?: number
  ): Promise<{ success: boolean; error?: string }> {
    // Build VS Code URL scheme: vscode://file/path:line:column
    // This works on systems where VS Code's URL handler is registered
    // URL encode the path to handle special characters (spaces, brackets, etc.)
    // Handle both Unix (/) and Windows (\) path separators
    const normalizedPath = filePath.replace(/\\/g, '/');
    const encodedPath = normalizedPath.startsWith('/')
      ? '/' + normalizedPath.slice(1).split('/').map(encodeURIComponent).join('/')
      : normalizedPath.split('/').map(encodeURIComponent).join('/');
    let url = `vscode://file${encodedPath}`;
    if (line !== undefined && line > 0) {
      url += `:${line}`;
      if (column !== undefined && column > 0) {
        url += `:${column}`;
      }
    }

    try {
      // Use anchor click approach which is most reliable for custom URL schemes
      // This triggers the browser's URL handler without navigation issues
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open in editor',
      };
    }
  }

  // File picker - uses server-side file browser dialog
  async openDirectory(): Promise<DialogResult> {
    const fileBrowser = getGlobalFileBrowser();

    if (!fileBrowser) {
      logger.error('File browser not initialized');
      return { canceled: true, filePaths: [] };
    }

    const path = await fileBrowser();

    if (!path) {
      return { canceled: true, filePaths: [] };
    }

    // Validate with server
    const result = await this.post<{
      success: boolean;
      path?: string;
      isAllowed?: boolean;
      error?: string;
    }>('/api/fs/validate-path', { filePath: path });

    if (result.success && result.path && result.isAllowed !== false) {
      return { canceled: false, filePaths: [result.path] };
    }

    logger.error('Invalid directory:', result.error || 'Path not allowed');
    return { canceled: true, filePaths: [] };
  }

  async openFile(_options?: object): Promise<DialogResult> {
    const fileBrowser = getGlobalFileBrowser();

    if (!fileBrowser) {
      logger.error('File browser not initialized');
      return { canceled: true, filePaths: [] };
    }

    // For now, use the same directory browser (could be enhanced for file selection)
    const path = await fileBrowser();

    if (!path) {
      return { canceled: true, filePaths: [] };
    }

    const result = await this.post<{ success: boolean; exists: boolean }>('/api/fs/exists', {
      filePath: path,
    });

    if (result.success && result.exists) {
      return { canceled: false, filePaths: [path] };
    }

    logger.error('File not found');
    return { canceled: true, filePaths: [] };
  }

  // File system operations
  async readFile(filePath: string): Promise<FileResult> {
    return this.post('/api/fs/read', { filePath });
  }

  async writeFile(filePath: string, content: string): Promise<WriteResult> {
    return this.post('/api/fs/write', { filePath, content });
  }

  async mkdir(dirPath: string): Promise<WriteResult> {
    return this.post('/api/fs/mkdir', { dirPath });
  }

  async readdir(dirPath: string): Promise<ReaddirResult> {
    return this.post('/api/fs/readdir', { dirPath });
  }

  async exists(filePath: string): Promise<boolean> {
    const result = await this.post<{ success: boolean; exists: boolean }>('/api/fs/exists', {
      filePath,
    });
    return result.exists;
  }

  async stat(filePath: string): Promise<StatResult> {
    return this.post('/api/fs/stat', { filePath });
  }

  async deleteFile(filePath: string): Promise<WriteResult> {
    return this.post('/api/fs/delete', { filePath });
  }

  async trashItem(filePath: string): Promise<WriteResult> {
    // In web mode, trash is just delete
    return this.deleteFile(filePath);
  }

  async copyItem(
    sourcePath: string,
    destinationPath: string,
    overwrite?: boolean
  ): Promise<WriteResult & { exists?: boolean }> {
    return this.post('/api/fs/copy', { sourcePath, destinationPath, overwrite });
  }

  async moveItem(
    sourcePath: string,
    destinationPath: string,
    overwrite?: boolean
  ): Promise<WriteResult & { exists?: boolean }> {
    return this.post('/api/fs/move', { sourcePath, destinationPath, overwrite });
  }

  async downloadItem(filePath: string): Promise<void> {
    const serverUrl = getServerUrl();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const apiKey = getApiKey();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
    const token = getSessionToken();
    if (token) {
      headers['X-Session-Token'] = token;
    }

    const response = await fetch(`${serverUrl}/api/fs/download`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ filePath }),
    });

    if (response.status === 401 || response.status === 403) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(error.error || `Download failed with status ${response.status}`);
    }

    // Create download from response blob
    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    const fileNameMatch = contentDisposition?.match(/filename="(.+)"/);
    const fileName = fileNameMatch ? fileNameMatch[1] : filePath.split('/').pop() || 'download';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async getPath(name: string): Promise<string> {
    // Server provides data directory
    if (name === 'userData') {
      const result = await this.get<{ dataDir: string }>('/api/health/detailed');
      return result.dataDir || '/data';
    }
    return `/data/${name}`;
  }

  async saveImageToTemp(
    data: string,
    filename: string,
    mimeType: string,
    projectPath?: string
  ): Promise<SaveImageResult> {
    return this.post('/api/fs/save-image', {
      data,
      filename,
      mimeType,
      projectPath,
    });
  }

  async saveBoardBackground(
    data: string,
    filename: string,
    mimeType: string,
    projectPath: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    return this.post('/api/fs/save-board-background', {
      data,
      filename,
      mimeType,
      projectPath,
    });
  }

  async deleteBoardBackground(projectPath: string): Promise<{ success: boolean; error?: string }> {
    return this.post('/api/fs/delete-board-background', { projectPath });
  }

  // CLI checks - server-side
  async checkClaudeCli(): Promise<{
    success: boolean;
    status?: string;
    method?: string;
    version?: string;
    path?: string;
    recommendation?: string;
    installCommands?: {
      macos?: string;
      windows?: string;
      linux?: string;
      npm?: string;
    };
    error?: string;
  }> {
    return this.get('/api/setup/claude-status');
  }

  // Model API
  model = createModelClient({ get: this.get.bind(this) });

  // Setup API
  setup = {
    reconnectProvider: (provider: CliConnectionProvider, request: ProviderReconnectRequest) =>
      this.reconnectSetupProvider(provider, request),
    getProviderConnectionTarget: async (provider: CliConnectionProvider) => {
      CliConnectionProviderSchema.parse(provider);
      const response = ProviderConnectionTargetResponseSchema.parse(
        await this.get(`/api/setup/connection-target?provider=${provider}`)
      );
      if (response.target.provider !== provider)
        throw new Error('Provider connection target does not match provider.');
      return response;
    },
    disconnectProvider: (provider: CliConnectionProvider, request: ProviderDisconnectRequest) =>
      this.disconnectSetupProvider(provider, request),
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
    }> => this.get('/api/setup/claude-status'),

    installClaude: async (signal?: AbortSignal): Promise<ProviderInstallGuidance> =>
      this.parseInstallGuidance(
        'claude',
        await this.post('/api/setup/install-claude', undefined, signal)
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
    }> => this.reconnectSetupProvider('claude', request),

    deauthClaude: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => this.disconnectSetupProvider('claude', request),

    getCredentialTarget: async (provider: string) => {
      const name = SetupCredentialProviderSchema.parse(provider);
      const preview = SetupCredentialTargetResponseSchema.parse(
        await this.get(`/api/setup/credential-target?provider=${name}`)
      );
      if (preview.target.provider !== name)
        throw new Error('Credential target does not match provider.');
      return preview;
    },
    storeApiKey: async (provider: string, apiKey: string) =>
      this.changeSetupCredential('store', provider, apiKey),

    deleteApiKey: async (provider: string) => this.changeSetupCredential('delete', provider),

    getApiKeys: (): Promise<{
      success: boolean;
      hasAnthropicKey: boolean;
      hasGoogleKey: boolean;
      hasOpenaiKey: boolean;
    }> => this.get('/api/setup/api-keys'),

    getPlatform: (): Promise<{
      success: boolean;
      platform: string;
      arch: string;
      homeDir: string;
      isWindows: boolean;
      isMac: boolean;
      isLinux: boolean;
    }> => this.get('/api/setup/platform'),

    getClaudeVerificationTarget: async (authMethod: 'cli' | 'api_key') => {
      const response = ClaudeVerificationTargetResponseSchema.parse(
        await this.get(`/api/setup/claude-verification-target?authMethod=${authMethod}`)
      );
      if (response.target.authMethod !== authMethod)
        throw new Error('Claude verification method does not match selection.');
      return response;
    },
    verifyClaudeAuth: async (input: ClaudeVerificationRequest) => {
      const request = ClaudeVerificationRequestSchema.parse(input);
      const preview = await this.setup.getClaudeVerificationTarget(request.target.authMethod);
      if (JSON.stringify(preview.target) !== JSON.stringify(request.target))
        throw new Error('Claude verification target changed. Inspect and confirm it again.');
      const response = ClaudeVerificationResponseSchema.parse(
        await this.post('/api/setup/verify-claude-auth', request)
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
    }> => this.get('/api/setup/gh-status'),

    getGithubAuthenticationTarget: async () =>
      GithubAuthenticationTargetResponseSchema.parse(
        await this.get('/api/setup/github-authentication-target')
      ),
    verifyGithubAuth: async (input: GithubAuthenticationRequest) => {
      const request = GithubAuthenticationRequestSchema.parse(input);
      const preview = await this.setup.getGithubAuthenticationTarget();
      if (JSON.stringify(preview.target) !== JSON.stringify(request.target))
        throw new Error('GitHub target changed. Inspect and confirm it again.');
      const response = GithubAuthenticationResponseSchema.parse(
        await this.post('/api/setup/verify-github-auth', request)
      );
      if (JSON.stringify(response.target) !== JSON.stringify(request.target))
        throw new Error('GitHub response target does not match confirmation.');
      return response;
    },

    // Cursor CLI methods
    getCursorStatus: async (): Promise<CursorSetupStatus> => {
      const result = CursorSetupStatusSchema.safeParse(await this.get('/api/setup/cursor-status'));
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
    }> => this.reconnectSetupProvider('cursor', request),

    deauthCursor: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => this.disconnectSetupProvider('cursor', request),

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
    }> => this.reconnectSetupProvider('opencode', request),

    deauthOpencode: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => this.disconnectSetupProvider('opencode', request),

    getCursorConfig: async (projectPath: string) =>
      CursorModelConfigResponseSchema.parse(
        await this.get(`/api/setup/cursor-config?projectPath=${encodeURIComponent(projectPath)}`)
      ),

    getCursorModelConfigTarget: async (projectPath: string) =>
      CursorModelConfigTargetResponseSchema.parse(
        await this.get(
          `/api/setup/cursor-config/target?projectPath=${encodeURIComponent(projectPath)}`
        )
      ),

    setCursorDefaultModel: async (input: CursorDefaultModelRequest) => {
      const request = CursorDefaultModelRequestSchema.parse(input);
      const target = await this.preflightCursorModelConfig(request.target);
      const result = CursorDefaultModelResponseSchema.parse(
        await this.post('/api/setup/cursor-config/default-model', request)
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
      const target = await this.preflightCursorModelConfig(request.target);
      const result = CursorEnabledModelsResponseSchema.parse(
        await this.post('/api/setup/cursor-config/models', request)
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
      this.get(
        `/api/setup/cursor-permissions${projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : ''}`
      ),

    getCursorPermissionsTarget: async (scope: 'global' | 'project', projectPath?: string) =>
      CursorPermissionsTargetResponseSchema.parse(
        await this.get(
          `/api/setup/cursor-permissions/target?scope=${scope}${projectPath ? `&projectPath=${encodeURIComponent(projectPath)}` : ''}`
        )
      ),

    applyCursorPermissionProfile: async (input: CursorProfileRequest) => {
      const request = CursorProfileRequestSchema.parse(input);
      const target = await this.preflightCursorPermissions(request.target);
      return this.parseCursorPermissionsMutation(
        await this.post('/api/setup/cursor-permissions/profile', request),
        target
      );
    },

    setCursorCustomPermissions: async (input: CursorCustomPermissionsRequest) => {
      const request = CursorCustomPermissionsRequestSchema.parse(input);
      const target = await this.preflightCursorPermissions(request.target);
      return this.parseCursorPermissionsMutation(
        await this.post('/api/setup/cursor-permissions/custom', request),
        target
      );
    },

    deleteCursorProjectPermissions: async (input: CursorDeletePermissionsRequest) => {
      const request = CursorDeletePermissionsRequestSchema.parse(input);
      const target = await this.preflightCursorPermissions(request.target);
      return this.parseCursorPermissionsMutation(
        await this.httpDelete('/api/setup/cursor-permissions', request),
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
      this.get(
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
    }> => this.get('/api/setup/codex-status'),

    installCodex: async (signal?: AbortSignal): Promise<ProviderInstallGuidance> =>
      this.parseInstallGuidance(
        'codex',
        await this.post('/api/setup/install-codex', undefined, signal)
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
    }> => this.reconnectSetupProvider('codex', request),

    deauthCodex: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => this.disconnectSetupProvider('codex', request),

    getCodexVerificationTarget: async (authMethod: 'cli' | 'api_key') => {
      const response = CodexVerificationTargetResponseSchema.parse(
        await this.get(`/api/setup/codex-verification-target?authMethod=${authMethod}`)
      );
      if (response.target.authMethod !== authMethod)
        throw new Error('Codex verification method does not match selection.');
      return response;
    },
    verifyCodexAuth: async (input: CodexVerificationRequest) => {
      const request = CodexVerificationRequestSchema.parse(input);
      const preview = await this.setup.getCodexVerificationTarget(request.target.authMethod);
      if (JSON.stringify(preview.target) !== JSON.stringify(request.target))
        throw new Error('Codex verification target changed. Inspect and confirm it again.');
      const response = CodexVerificationResponseSchema.parse(
        await this.post('/api/setup/verify-codex-auth', request)
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
    }> => this.get('/api/setup/opencode-status'),

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
    }> => this.get(`/api/setup/opencode/models${refresh ? '?refresh=true' : ''}`),

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
    }> => this.post('/api/setup/opencode/models/refresh'),

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
    }> => this.get('/api/setup/opencode/providers'),

    clearOpencodeCache: (): Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }> => this.post('/api/setup/opencode/cache/clear'),

    // Gemini CLI methods
    getGeminiStatus: async (): Promise<GeminiSetupStatus> => {
      const result = GeminiSetupStatusSchema.safeParse(await this.get('/api/setup/gemini-status'));
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
    }> => this.reconnectSetupProvider('gemini', request),

    deauthGemini: (
      request: ProviderDisconnectRequest
    ): Promise<{
      success: boolean;
      requiresManualDeauth?: boolean;
      command?: string;
      message?: string;
      error?: string;
    }> => this.disconnectSetupProvider('gemini', request),

    // Copilot SDK methods
    getCopilotStatus: async (): Promise<CopilotSetupStatus> => {
      const result = CopilotSetupStatusSchema.safeParse(
        await this.get('/api/setup/copilot-status')
      );
      if (!result.success) throw new Error('Copilot status protocol is unavailable.');
      return result.data;
    },

    onInstallProgress: (
      callback: (progress: { cli?: string; data?: string; type?: string }) => void
    ) => {
      return this.subscribeToEvent('agent:stream', callback as EventCallback);
    },

    onAuthProgress: (
      callback: (progress: { cli?: string; data?: string; type?: string }) => void
    ) => {
      return this.subscribeToEvent('agent:stream', callback as EventCallback);
    },
  };

  // z.ai API
  zai = createZaiClient({ get: this.get.bind(this), post: this.post.bind(this) });

  // Features API
  features: FeaturesAPI & {
    bulkUpdate: (
      projectPath: string,
      featureIds: string[],
      updates: Partial<Feature>
    ) => Promise<{
      success: boolean;
      updatedCount?: number;
      failedCount?: number;
      results?: Array<{ featureId: string; success: boolean; error?: string }>;
      features?: Feature[];
      error?: string;
    }>;
    bulkDelete: (
      projectPath: string,
      featureIds: string[]
    ) => Promise<{
      success: boolean;
      deletedCount?: number;
      failedCount?: number;
      results?: Array<{ featureId: string; success: boolean; error?: string }>;
      error?: string;
    }>;
    export: (
      projectPath: string,
      options?: {
        featureIds?: string[];
        format?: 'json' | 'yaml';
        includeHistory?: boolean;
        includePlanSpec?: boolean;
        category?: string;
        status?: string;
        prettyPrint?: boolean;
        metadata?: Record<string, unknown>;
      }
    ) => Promise<{
      success: boolean;
      data?: string;
      format?: 'json' | 'yaml';
      contentType?: string;
      filename?: string;
      error?: string;
    }>;
    import: (
      projectPath: string,
      data: string,
      options?: {
        overwrite?: boolean;
        preserveBranchInfo?: boolean;
        targetCategory?: string;
      }
    ) => Promise<{
      success: boolean;
      importedCount?: number;
      failedCount?: number;
      results?: Array<{
        success: boolean;
        featureId?: string;
        importedAt: string;
        warnings?: string[];
        errors?: string[];
        wasOverwritten?: boolean;
      }>;
      error?: string;
    }>;
    checkConflicts: (
      projectPath: string,
      data: string
    ) => Promise<{
      success: boolean;
      hasConflicts?: boolean;
      conflicts?: Array<{
        featureId: string;
        title?: string;
        existingTitle?: string;
        hasConflict: boolean;
      }>;
      totalFeatures?: number;
      conflictCount?: number;
      error?: string;
    }>;
  } = createFeaturesClient({ get: this.get.bind(this), post: this.post.bind(this) });

  // Auto Mode API
  autoMode: AutoModeAPI = createAutoModeClient({
    post: this.post.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Enhance Prompt API
  enhancePrompt = createEnhancePromptClient({ post: this.post.bind(this) });

  // Worktree API
  worktree: WorktreeAPI = createWorktreeClient({
    post: this.post.bind(this),
    get: this.get.bind(this),
    put: this.put.bind(this),
    httpDelete: this.httpDelete.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
    inspectGit: (project) => this.executionEnvironments.inspectGit(project),
  });

  // Git API
  git: GitAPI = createGitClient({ post: this.post.bind(this) });

  // Spec Regeneration API
  specRegeneration: SpecRegenerationAPI = createSpecRegenerationClient({
    post: this.post.bind(this),
    get: this.get.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Running Agents API
  runningAgents = createRunningAgentsClient({ get: this.get.bind(this) });

  // GitHub API
  github: GitHubAPI = createGithubClient({
    post: this.post.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Workspace API
  workspace = createWorkspaceClient({ get: this.get.bind(this) });

  // Agent API
  agent = createAgentClient({
    post: this.post.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Templates API
  templates = createTemplatesClient({ post: this.post.bind(this) });

  // Settings API - persistent file-based settings
  settings = createSettingsClient({
    get: this.get.bind(this),
    put: this.put.bind(this),
    post: this.post.bind(this),
  });

  executionEnvironments = createExecutionEnvironmentsClient({
    post: this.post.bind(this),
    put: this.put.bind(this),
  });

  modelTimeouts = createModelTimeoutsClient({ get: this.get.bind(this), put: this.put.bind(this) });

  directEndpoints = createDirectEndpointsClient({
    get: this.get.bind(this),
    put: this.put.bind(this),
    post: this.post.bind(this),
  });

  // Sessions API
  sessions = createSessionsClient({
    get: this.get.bind(this),
    post: this.post.bind(this),
    put: this.put.bind(this),
    httpDelete: this.httpDelete.bind(this),
  });

  // Claude API
  claude = createClaudeClient({ get: this.get.bind(this) });

  // Codex API
  codex = createCodexClient({ get: this.get.bind(this) });

  // Gemini API
  gemini = createGeminiClient({ get: this.get.bind(this) });

  // Context API
  context = createContextClient({ post: this.post.bind(this) });

  // Backlog Plan API
  backlogPlan = createBacklogPlanClient({
    post: this.post.bind(this),
    get: this.get.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Ideation API - brainstorming and idea management
  ideation: IdeationAPI = createIdeationClient({
    post: this.post.bind(this),
    get: this.get.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Notifications API - project-level notifications
  notifications: NotificationsAPI & {
    onNotificationCreated: (callback: (notification: Notification) => void) => () => void;
  } = createNotificationsClient({
    post: this.post.bind(this),
    subscribeToEvent: this.subscribeToEvent.bind(this),
  });

  // Event History API - stored events for debugging and replay
  eventHistory: EventHistoryAPI = createEventHistoryClient({ post: this.post.bind(this) });

  // MCP API - Test MCP server connections and list tools
  // SECURITY: Only accepts serverId, not arbitrary serverConfig, to prevent
  // drive-by command execution attacks. Servers must be saved first.
  mcp = createMcpClient({ post: this.post.bind(this) });

  // Pipeline API - custom workflow pipeline steps
  pipeline = createPipelineClient({ post: this.post.bind(this) });
}

// Singleton instance
let httpApiClientInstance: HttpApiClient | null = null;

export function getHttpApiClient(): HttpApiClient {
  if (!httpApiClientInstance) {
    httpApiClientInstance = new HttpApiClient();
  }
  return httpApiClientInstance;
}

// Start API key initialization immediately when this module is imported
// This ensures the init promise is created early, even before React components mount
// The actual async work happens in the background and won't block module loading
initApiKey().catch((error) => {
  logger.error('Failed to initialize API key:', error);
});
