import type { HttpDomainTransport } from './transport';
import type {
  ExecutionEnvironmentSettings,
  ExecutionEnvironmentSettingsResponse,
  ExecutionEnvironmentSelection,
  DockerConnectionDiagnostic,
  DockerPreparationResult,
  SSHHostKey,
  SSHDiagnostic,
} from '@automaker/types';

export function createExecutionEnvironmentsClient(
  transport: Pick<HttpDomainTransport, 'post' | 'put'>
) {
  return {
    inspectGit: (
      path: string
    ): Promise<{
      success: boolean;
      executionEnvironment?: import('@automaker/types').ProjectGitEnvironment;
      error?: string;
    }> => transport.post('/api/git/environment', { projectPath: path }),
    inspectProvider: (
      projectPath: string,
      provider: import('@automaker/types').RemoteSdkProvider
    ): Promise<{
      success: boolean;
      status?: import('@automaker/types').RemoteProviderStatus;
      error?: string;
    }> =>
      transport.post('/api/settings/execution-environments/providers/inspect', {
        projectPath,
        provider,
      }),
    installProvider: (
      projectPath: string,
      provider: import('@automaker/types').RemoteSdkProvider,
      targetId: string
    ): Promise<{
      success: boolean;
      status?: import('@automaker/types').RemoteProviderStatus;
      error?: string;
    }> =>
      transport.post('/api/settings/execution-environments/providers/install', {
        projectPath,
        provider,
        targetId,
        accepted: true,
      }),
    saveProviderKey: (
      projectPath: string,
      provider: import('@automaker/types').RemoteSdkProvider,
      targetId: string,
      apiKey: string
    ): Promise<{
      success: boolean;
      status?: import('@automaker/types').RemoteProviderStatus;
      error?: string;
    }> =>
      transport.post('/api/settings/execution-environments/providers/key', {
        projectPath,
        provider,
        targetId,
        apiKey,
        accepted: true,
      }),
    clearProviderKey: (
      projectPath: string,
      provider: import('@automaker/types').RemoteSdkProvider,
      targetId: string
    ): Promise<{
      success: boolean;
      status?: import('@automaker/types').RemoteProviderStatus;
      error?: string;
    }> =>
      transport.post('/api/settings/execution-environments/providers/key', {
        projectPath,
        provider,
        targetId,
        clear: true,
        accepted: true,
      }),
    inspectFeature: (
      projectPath: string,
      featureId: string
    ): Promise<{
      success: boolean;
      binding?: import('@automaker/types').ExecutionEnvironmentBinding | null;
      selectedType?: string;
      error?: string;
    }> =>
      transport.post('/api/settings/execution-environments/feature/inspect', {
        projectPath,
        featureId,
      }),
    scanSSH: (
      profileId: string
    ): Promise<{ success: boolean; hostKey?: SSHHostKey; error?: string }> =>
      transport.post('/api/settings/execution-environments/ssh/scan', { profileId }),
    trustSSH: (
      profileId: string,
      fingerprint: string,
      replace = false
    ): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/ssh/trust', {
        profileId,
        fingerprint,
        replace,
        accepted: true,
      }),
    saveSSHKey: (
      profileId: string,
      privateKey: string,
      passphrase?: string
    ): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/ssh/key', {
        profileId,
        privateKey,
        passphrase: passphrase || undefined,
      }),
    clearSSHKey: (profileId: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/ssh/key', { profileId, clear: true }),
    checkSSH: (
      profileId: string,
      projectPath?: string
    ): Promise<{ success: boolean; diagnostic?: SSHDiagnostic; error?: string }> =>
      transport.post('/api/settings/execution-environments/ssh/check', { profileId, projectPath }),
    prepareSSH: (profileId: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/ssh/prepare', {
        profileId,
        accepted: true,
      }),
    prepareSSHProject: (
      profileId: string,
      projectPath: string,
      source:
        | { method: 'import' }
        | { method: 'clone'; repositoryUrl: string }
        | { method: 'existing'; remotePath: string }
    ): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/ssh/project', {
        profileId,
        projectPath,
        source,
        accepted: true,
      }),
    recoverSSH: (
      profileId: string,
      projectPath: string
    ): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/ssh/recover', {
        profileId,
        projectPath,
        accepted: true,
      }),
    prepareDocker: (
      projectPath?: string,
      profileId?: string
    ): Promise<{ success: boolean; preparation?: DockerPreparationResult; error?: string }> =>
      transport.post('/api/settings/execution-environments/docker/prepare', {
        projectPath,
        profileId,
        accepted: true,
      }),
    confirmAutoFallback: (projectPath?: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/auto/confirm', {
        projectPath,
        accepted: true,
        warningVersion: 1,
      }),
    revokeAutoFallback: (projectPath?: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/auto/revoke', { projectPath }),
    confirmLocal: (projectPath?: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/local/confirm', {
        projectPath,
        accepted: true,
        warningVersion: 1,
      }),
    revokeLocal: (projectPath?: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/local/revoke', { projectPath }),
    inspect: (projectPath?: string): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.post('/api/settings/execution-environments/inspect', { projectPath }),
    saveGlobal: (
      settings: ExecutionEnvironmentSettings
    ): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.put('/api/settings/execution-environments/global', { settings }),
    saveProject: (
      projectPath: string,
      selection: ExecutionEnvironmentSelection | null
    ): Promise<ExecutionEnvironmentSettingsResponse> =>
      transport.put('/api/settings/execution-environments/project', { projectPath, selection }),
    checkDocker: (
      profileId?: string
    ): Promise<{ success: boolean; diagnostic?: DockerConnectionDiagnostic; error?: string }> =>
      transport.post('/api/settings/execution-environments/docker/check', { profileId }),
  };
}
