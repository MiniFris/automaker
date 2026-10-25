/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface DiscoverAgentsInput {
  projectPath?: string | undefined;
  sources?: ('project' | 'user')[] | undefined;
}

export interface ProjectSettingsReadInput {
  projectPath: string;
}

export interface LocalStorageMigrationInput {
  data: {
    'automaker-storage'?: string | undefined;
    'automaker-setup'?: string | undefined;
    'worktree-panel-collapsed'?: string | undefined;
    'file-browser-recent-folders'?: string | undefined;
    'automaker:lastProjectDir'?: string | undefined;
  };
}

export interface ProjectSettingsUpdateInput {
  projectPath: string;
  updates: Record<string, unknown>;
}

export interface ModelTimeoutUpdateInput {
  timeouts: unknown;
}
