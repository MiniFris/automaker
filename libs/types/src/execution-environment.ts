/** Environment selection is separate from model/provider selection. */
export type ExecutionEnvironmentSelection =
  | { mode: 'local' | 'auto' }
  | { mode: 'profile'; profileId: string };

export type ExecutionEnvironmentProfile = {
  id: string;
  name: string;
} & (
  | { type: 'docker'; context?: string }
  | {
      type: 'ssh';
      host: string;
      port: number;
      username: string;
      basePath: string;
      /** Reference only; never a private key, password, or arbitrary SSH command. */
      credentialId?: string;
    }
);

export interface ExecutionEnvironmentSettings {
  default: ExecutionEnvironmentSelection;
  profiles: ExecutionEnvironmentProfile[];
}

export interface ResolvedExecutionEnvironment {
  selection: ExecutionEnvironmentSelection;
  source: 'global' | 'project';
  type: 'local' | 'auto' | 'docker' | 'ssh' | 'missing-profile';
  profile?: ExecutionEnvironmentProfile;
  /** Whether the Direct runtime can use the selected environment now. */
  runtimeIntegrated: boolean;
}

export interface ExecutionEnvironmentBinding {
  version: 1;
  id: string;
  type: 'legacy' | 'local' | 'docker' | 'ssh';
  projectPath: string;
  cwd: string;
  createdAt: string;
  /** A binding belongs to the server installation / OS user, not a portable grant. */
  serverIdentity: string;
  selection: ExecutionEnvironmentSelection;
  source: 'global' | 'project';
  /** Server-issued, immutable Docker project descriptor; never supplied by a model. */
  docker?: DockerProjectBinding;
  ssh?: SSHProjectBinding;
  /** Effective cwd may differ from the local control-plane directory. */
  runtimeCwd?: string;
  /** Feature workspace is server-pinned; branchName in board metadata is its target branch. */
  sshWorkspace?: SSHFeatureWorkspace;
  /** Managed Docker/Auto feature; cwd remains the immutable controller identity. */
  featureWorkspace?: FeatureWorkspace;
  /** Durable intent pins the environment before feature worktree creation. */
  featurePreparation?: { targetBranch?: string | null };
  fallbackReason?: 'docker-preflight-unavailable';
}

export interface FeatureWorkspace {
  version: 1;
  branch: string;
  baseBranch: string;
  baseCommit: string;
}
export type SSHFeatureWorkspace = FeatureWorkspace;

export type SSHEnvironmentProfile = Extract<ExecutionEnvironmentProfile, { type: 'ssh' }>;
export interface SSHHostKey {
  algorithm: string;
  fingerprint: string;
}
export interface SSHProjectBinding {
  version: 1;
  ready: boolean;
  preparationPath?: string;
  owner: string;
  profile: SSHEnvironmentProfile;
  fingerprint: string;
  identity: string;
  projectPath: string;
  remotePath: string;
  workerPath: string;
  workerHash: string;
  cancelPath: string;
  cancelHash: string;
  jobsDirectory: string;
}
export interface SSHEnvironmentStatus {
  trustedHost?: SSHHostKey;
  hasPrivateKey: boolean;
  agentAvailable: boolean;
  project?: {
    remotePath: string;
    pendingOperations: number;
    preparing?: boolean;
    stagingPath?: string;
  };
}
export interface SSHDiagnostic {
  status: 'available' | 'trust-required' | 'host-key-changed' | 'unavailable';
  checkedAt: string;
  message: string;
  hostKey?: SSHHostKey;
  worker: 'not-tested' | 'ready';
  project: 'not-tested' | 'ready';
  remotePath?: string;
}

export interface DockerProjectBinding {
  owner: string;
  engineId: string;
  context?: string;
  containerId: string;
  imageId: string;
  projectPath: string;
  mount: { type: 'bind' | 'volume'; source: string; subpath?: string };
  user: string;
}

/** Git UI scope. path is a controller alias, NOT a path to execute in a host shell. */
export interface ProjectGitEnvironment {
  type: 'local' | 'docker' | 'ssh';
  projectPath: string;
  path: string;
  runtimeCwd: string;
  root: string;
  targetId: string;
  pinned: boolean;
}

export interface LocalExecutionConsentStatus {
  warningVersion: 1;
  confirmed: boolean;
  scope: 'global' | 'project' | null;
  legacy: boolean;
  serverContainerized: boolean;
  autoFallbackConfirmed?: boolean;
  autoFallbackScope?: 'global' | 'project' | null;
}

export interface DockerPreparationResult {
  connection: 'available';
  containerLifecycle: 'verified';
  projectStorage: 'not-tested' | 'verified';
  checkedAt: string;
  message: string;
  containerId?: string;
}

export interface ExecutionEnvironmentSettingsResponse {
  success: boolean;
  settings: ExecutionEnvironmentSettings;
  /** null means inherit, not an explicit local selection. */
  projectOverride: ExecutionEnvironmentSelection | null;
  resolved: ResolvedExecutionEnvironment;
  localConsent?: LocalExecutionConsentStatus;
  ssh?: SSHEnvironmentStatus;
  error?: string;
}

export type RemoteSdkProvider = 'claude' | 'codex' | 'copilot';
export interface RemoteProviderStatus {
  provider: RemoteSdkProvider;
  targetId: string;
  environment: 'docker' | 'ssh';
  cwd: string;
  packageVersion: string;
  installed: boolean;
  root: string;
  hasStoredKey: boolean;
  credentialSource: 'managed-key' | 'target-environment' | 'target-cache' | 'not-detected';
  /** Presence is not a live model access/billing/permissions check. */
  authentication: 'configured-unverified' | 'not-detected';
}

export type DockerConnectionStatus =
  | 'available'
  | 'client-missing'
  | 'permission-denied'
  | 'unreachable'
  | 'context-unavailable'
  | 'timeout'
  | 'cancelled'
  | 'invalid-response'
  | 'unavailable';

export interface DockerConnectionDiagnostic {
  status: DockerConnectionStatus;
  checkedAt: string;
  scope: 'connection-only';
  /** A successful info call does not prove permission to create containers. */
  containerLifecycle: 'not-tested';
  projectStorage: 'not-tested';
  platform: string;
  serverContainerized: boolean;
  message: string;
  remediation: string[];
  documentation: Array<{ label: string; url: string }>;
}
/** Optional on legacy dev servers; authoritative metadata on captured runtime sessions. */
export interface DevServerEnvironmentMetadata {
  sessionId?: string;
  executionEnvironment?: ProjectGitEnvironment;
  preserveUrlHost?: boolean;
  targetPort?: number;
  isRunning?: boolean;
  error?: string;
  exitCode?: number | null;
  urlDetected?: boolean;
}
