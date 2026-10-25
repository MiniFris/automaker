import type { HttpDomainTransport } from './transport';

export function createSettingsClient(transport: Pick<HttpDomainTransport, 'get' | 'put' | 'post'>) {
  return {
    // Get settings status (check if migration needed)
    getStatus: (): Promise<{
      success: boolean;
      hasGlobalSettings: boolean;
      hasCredentials: boolean;
      dataDir: string;
      needsMigration: boolean;
    }> => transport.get('/api/settings/status'),

    // Global settings
    getGlobal: (): Promise<{
      success: boolean;
      settings?: {
        version: number;
        theme: string;
        sidebarOpen: boolean;
        chatHistoryOpen: boolean;
        maxConcurrency: number;
        defaultSkipTests: boolean;
        enableDependencyBlocking: boolean;
        useWorktrees: boolean;
        defaultPlanningMode: string;
        defaultRequirePlanApproval: boolean;
        muteDoneSound: boolean;
        enhancementModel: string;
        keyboardShortcuts: Record<string, string>;
        projects: unknown[];
        trashedProjects: unknown[];
        projectHistory: string[];
        projectHistoryIndex: number;
        lastProjectDir?: string;
        recentFolders: string[];
        worktreePanelCollapsed: boolean;
        lastSelectedSessionByProject: Record<string, string>;
        mcpServers?: Array<{
          id: string;
          name: string;
          description?: string;
          type?: 'stdio' | 'sse' | 'http';
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          url?: string;
          headers?: Record<string, string>;
          enabled?: boolean;
        }>;
        eventHooks?: Array<{
          id: string;
          trigger: string;
          enabled: boolean;
          action: Record<string, unknown>;
          name?: string;
        }>;
        ntfyEndpoints?: Array<{
          id: string;
          name: string;
          serverUrl: string;
          topic: string;
          authType: string;
          enabled: boolean;
        }>;
      };
      error?: string;
    }> => transport.get('/api/settings/global'),

    updateGlobal: (
      updates: Record<string, unknown>
    ): Promise<{
      success: boolean;
      settings?: Record<string, unknown>;
      error?: string;
    }> => transport.put('/api/settings/global', updates),

    // Credentials (masked for security)
    getCredentials: (): Promise<{
      success: boolean;
      credentials?: {
        anthropic: { configured: boolean; masked: string };
        google: { configured: boolean; masked: string };
        openai: { configured: boolean; masked: string };
      };
      error?: string;
    }> => transport.get('/api/settings/credentials'),

    // Project settings
    getProject: (
      projectPath: string
    ): Promise<{
      success: boolean;
      settings?: {
        version: number;
        theme?: string;
        useWorktrees?: boolean;
        currentWorktree?: { path: string | null; branch: string };
        worktrees?: Array<{
          path: string;
          branch: string;
          isMain: boolean;
          hasChanges?: boolean;
          changedFilesCount?: number;
        }>;
        boardBackground?: {
          imagePath: string | null;
          imageVersion?: number;
          cardOpacity: number;
          columnOpacity: number;
          columnBorderEnabled: boolean;
          cardGlassmorphism: boolean;
          cardBorderEnabled: boolean;
          cardBorderOpacity: number;
          hideScrollbar: boolean;
        };
        worktreePanelVisible?: boolean;
        showInitScriptIndicator?: boolean;
        defaultDeleteBranchWithWorktree?: boolean;
        autoDismissInitScriptIndicator?: boolean;
        worktreeCopyFiles?: string[];
        pinnedWorktreesCount?: number;
        worktreeDropdownThreshold?: number;
        alwaysUseWorktreeDropdown?: boolean;
        lastSelectedSessionId?: string;
        testCommand?: string;
      };
      error?: string;
    }> => transport.post('/api/settings/project', { projectPath }),

    updateProject: (
      projectPath: string,
      updates: Record<string, unknown>
    ): Promise<{
      success: boolean;
      settings?: Record<string, unknown>;
      error?: string;
    }> => transport.put('/api/settings/project', { projectPath, updates }),

    // Migration from localStorage
    migrate: (data: {
      'automaker-storage'?: string;
      'automaker-setup'?: string;
      'worktree-panel-collapsed'?: string;
      'file-browser-recent-folders'?: string;
      'automaker:lastProjectDir'?: string;
    }): Promise<{
      success: boolean;
      migratedGlobalSettings: boolean;
      migratedCredentials: boolean;
      credentialImportRequired: boolean;
      migratedProjectCount: number;
      errors: string[];
    }> => transport.post('/api/settings/migrate', { data }),

    // Filesystem agents discovery (read-only)
    discoverAgents: (
      projectPath?: string,
      sources?: Array<'user' | 'project'>
    ): Promise<{
      success: boolean;
      agents?: Array<{
        name: string;
        definition: {
          description: string;
          prompt: string;
          tools?: string[];
          model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
        };
        source: 'user' | 'project';
        filePath: string;
      }>;
      error?: string;
    }> => transport.post('/api/settings/agents/discover', { projectPath, sources }),
  };
}
