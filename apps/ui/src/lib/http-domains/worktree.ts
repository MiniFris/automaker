import type { HttpDomainTransport } from './transport';
import type { createExecutionEnvironmentsClient } from './executionEnvironments';
import type { CreatePROptions } from '../electron';
import type { WorktreeAPI } from '@/types/electron';
import type {
  DevServerStartingEvent,
  DevServerStartedEvent,
  DevServerOutputEvent,
  DevServerStoppedEvent,
  DevServerUrlDetectedEvent,
  DevServerLogEvent,
  TestRunnerStartedEvent,
  TestRunnerOutputEvent,
  TestRunnerCompletedEvent,
  TestRunnerEvent,
  DevServerLogsResponse,
  TestLogsResponse,
} from '../http-api-client';

type WorktreeTransport = HttpDomainTransport & {
  inspectGit: ReturnType<typeof createExecutionEnvironmentsClient>['inspectGit'];
};
export function createWorktreeClient(transport: WorktreeTransport): WorktreeAPI {
  return {
    mergeFeature: (
      projectPath: string,
      branchName: string,
      worktreePath: string,
      targetBranch?: string,
      options?: object
    ) =>
      transport.post('/api/worktree/merge', {
        projectPath,
        branchName,
        worktreePath,
        targetBranch,
        options,
      }),
    getInfo: (projectPath: string, featureId: string) =>
      transport.post('/api/worktree/info', { projectPath, featureId }),
    getStatus: (projectPath: string, featureId: string) =>
      transport.post('/api/worktree/status', { projectPath, featureId }),
    list: (projectPath: string) => transport.post('/api/worktree/list', { projectPath }),
    listAll: (projectPath: string, includeDetails?: boolean, forceRefreshGitHub?: boolean) =>
      transport.post('/api/worktree/list', { projectPath, includeDetails, forceRefreshGitHub }),
    create: (projectPath: string, branchName: string, baseBranch?: string) =>
      transport.post('/api/worktree/create', {
        projectPath,
        branchName,
        baseBranch,
      }),
    delete: (projectPath: string, worktreePath: string, deleteBranch?: boolean) =>
      transport.post('/api/worktree/delete', {
        projectPath,
        worktreePath,
        deleteBranch,
      }),
    commit: (worktreePath: string, message: string, files?: string[]) =>
      transport.post('/api/worktree/commit', { worktreePath, message, files }),
    generateCommitMessage: (
      worktreePath: string,
      model?: string,
      thinkingLevel?: string,
      providerId?: string
    ) =>
      transport.post('/api/worktree/generate-commit-message', {
        worktreePath,
        model,
        thinkingLevel,
        providerId,
      }),
    generatePRDescription: (
      worktreePath: string,
      baseBranch?: string,
      model?: string,
      thinkingLevel?: string,
      providerId?: string
    ) =>
      transport.post('/api/worktree/generate-pr-description', {
        worktreePath,
        baseBranch,
        model,
        thinkingLevel,
        providerId,
      }),
    push: (worktreePath: string, force?: boolean, remote?: string, autoResolve?: boolean) =>
      transport.post('/api/worktree/push', { worktreePath, force, remote, autoResolve }),
    sync: (worktreePath: string, remote?: string) =>
      transport.post('/api/worktree/sync', { worktreePath, remote }),
    setTracking: (worktreePath: string, remote: string, branch?: string) =>
      transport.post('/api/worktree/set-tracking', { worktreePath, remote, branch }),
    createPR: (worktreePath: string, options?: CreatePROptions) =>
      transport.post('/api/worktree/create-pr', { worktreePath, ...options }),
    updatePRNumber: (worktreePath: string, prNumber: number, projectPath?: string) =>
      transport.post('/api/worktree/update-pr-number', { worktreePath, prNumber, projectPath }),
    getDiffs: (projectPath: string, featureId: string) =>
      transport.post('/api/worktree/diffs', { projectPath, featureId }),
    getFileDiff: (projectPath: string, featureId: string, filePath: string) =>
      transport.post('/api/worktree/file-diff', {
        projectPath,
        featureId,
        filePath,
      }),
    stageFiles: (worktreePath: string, files: string[], operation: 'stage' | 'unstage') =>
      transport.post('/api/worktree/stage-files', { worktreePath, files, operation }),
    pull: (worktreePath: string, remote?: string, stashIfNeeded?: boolean, remoteBranch?: string) =>
      transport.post('/api/worktree/pull', { worktreePath, remote, remoteBranch, stashIfNeeded }),
    checkoutBranch: (
      worktreePath: string,
      branchName: string,
      baseBranch?: string,
      stashChanges?: boolean,
      includeUntracked?: boolean
    ) =>
      transport.post('/api/worktree/checkout-branch', {
        worktreePath,
        branchName,
        baseBranch,
        stashChanges,
        includeUntracked,
      }),
    checkChanges: (worktreePath: string) =>
      transport.post('/api/worktree/check-changes', { worktreePath }),
    listBranches: (worktreePath: string, includeRemote?: boolean, signal?: AbortSignal) =>
      transport.post('/api/worktree/list-branches', { worktreePath, includeRemote }, signal),
    switchBranch: (worktreePath: string, branchName: string) =>
      transport.post('/api/worktree/switch-branch', { worktreePath, branchName }),
    listRemotes: (worktreePath: string) =>
      transport.post('/api/worktree/list-remotes', { worktreePath }),
    addRemote: (worktreePath: string, remoteName: string, remoteUrl: string) =>
      transport.post('/api/worktree/add-remote', { worktreePath, remoteName, remoteUrl }),
    openInEditor: (worktreePath: string, editorCommand?: string) =>
      transport.post('/api/worktree/open-in-editor', { worktreePath, editorCommand }),
    getDefaultEditor: () => transport.get('/api/worktree/default-editor'),
    getAvailableEditors: () => transport.get('/api/worktree/available-editors'),
    refreshEditors: () => transport.post('/api/worktree/refresh-editors', {}),
    getAvailableTerminals: () => transport.get('/api/worktree/available-terminals'),
    getDefaultTerminal: () => transport.get('/api/worktree/default-terminal'),
    refreshTerminals: () => transport.post('/api/worktree/refresh-terminals', {}),
    openInExternalTerminal: (worktreePath: string, terminalId?: string) =>
      transport.post('/api/worktree/open-in-external-terminal', { worktreePath, terminalId }),
    initGit: (projectPath: string) => transport.post('/api/worktree/init-git', { projectPath }),
    startDevServer: async (projectPath: string, worktreePath: string) => {
      const inspected = await transport.inspectGit(worktreePath);
      if (!inspected.success || !inspected.executionEnvironment)
        throw new Error(
          inspected.error || 'Cannot inspect the dev environment. No command was started.'
        );
      return transport.post<Awaited<ReturnType<WorktreeAPI['startDevServer']>>>(
        '/api/worktree/start-dev',
        { projectPath, worktreePath, environmentTargetId: inspected.executionEnvironment.targetId }
      );
    },
    stopDevServer: (worktreePath: string, sessionId?: string) =>
      transport.post('/api/worktree/stop-dev', { worktreePath, ...(sessionId && { sessionId }) }),
    listDevServers: () => transport.post('/api/worktree/list-dev-servers', {}),
    getDevServerLogs: (worktreePath: string, sessionId?: string): Promise<DevServerLogsResponse> =>
      transport.get(
        `/api/worktree/dev-server-logs?worktreePath=${encodeURIComponent(worktreePath)}${sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : ''}`
      ),
    onDevServerLogEvent: (callback: (event: DevServerLogEvent) => void) => {
      const unsub0 = transport.subscribeToEvent('dev-server:starting', (payload) =>
        callback({ type: 'dev-server:starting', payload: payload as DevServerStartingEvent })
      );
      const unsub1 = transport.subscribeToEvent('dev-server:started', (payload) =>
        callback({ type: 'dev-server:started', payload: payload as DevServerStartedEvent })
      );
      const unsub2 = transport.subscribeToEvent('dev-server:output', (payload) =>
        callback({ type: 'dev-server:output', payload: payload as DevServerOutputEvent })
      );
      const unsub3 = transport.subscribeToEvent('dev-server:stopped', (payload) =>
        callback({ type: 'dev-server:stopped', payload: payload as DevServerStoppedEvent })
      );
      const unsub4 = transport.subscribeToEvent('dev-server:url-detected', (payload) =>
        callback({ type: 'dev-server:url-detected', payload: payload as DevServerUrlDetectedEvent })
      );
      return () => {
        unsub0();
        unsub1();
        unsub2();
        unsub3();
        unsub4();
      };
    },
    getPRInfo: (worktreePath: string, branchName: string) =>
      transport.post('/api/worktree/pr-info', { worktreePath, branchName }),
    // Init script methods
    getInitScript: (projectPath: string) =>
      transport.get(`/api/worktree/init-script?projectPath=${encodeURIComponent(projectPath)}`),
    setInitScript: (projectPath: string, content: string) =>
      transport.put('/api/worktree/init-script', { projectPath, content }),
    deleteInitScript: (projectPath: string) =>
      transport.httpDelete('/api/worktree/init-script', { projectPath }),
    runInitScript: (projectPath: string, worktreePath: string, branch: string) =>
      transport.post('/api/worktree/run-init-script', { projectPath, worktreePath, branch }),
    discardChanges: (worktreePath: string, files?: string[]) =>
      transport.post('/api/worktree/discard-changes', { worktreePath, files }),
    onInitScriptEvent: (
      callback: (event: {
        type: 'worktree:init-started' | 'worktree:init-output' | 'worktree:init-completed';
        payload: unknown;
      }) => void
    ) => {
      // Note: subscribeToEvent callback receives (payload) not (_, payload)
      const unsub1 = transport.subscribeToEvent('worktree:init-started', (payload) =>
        callback({ type: 'worktree:init-started', payload })
      );
      const unsub2 = transport.subscribeToEvent('worktree:init-output', (payload) =>
        callback({ type: 'worktree:init-output', payload })
      );
      const unsub3 = transport.subscribeToEvent('worktree:init-completed', (payload) =>
        callback({ type: 'worktree:init-completed', payload })
      );
      return () => {
        unsub1();
        unsub2();
        unsub3();
      };
    },
    // Test runner methods
    startTests: async (
      worktreePath: string,
      options?: { projectPath?: string; testFile?: string }
    ) => {
      const inspected = await transport.inspectGit(worktreePath);
      if (!inspected.success || !inspected.executionEnvironment)
        throw new Error(
          inspected.error || 'Cannot inspect the test environment. No tests were started.'
        );
      return transport.post<Awaited<ReturnType<WorktreeAPI['startTests']>>>(
        '/api/worktree/start-tests',
        {
          worktreePath,
          ...options,
          environmentTargetId: inspected.executionEnvironment.targetId,
        }
      );
    },
    stopTests: (sessionId: string) => transport.post('/api/worktree/stop-tests', { sessionId }),
    getCommitLog: (worktreePath: string, limit?: number) =>
      transport.post('/api/worktree/commit-log', { worktreePath, limit }),
    stashPush: (worktreePath: string, message?: string, files?: string[]) =>
      transport.post('/api/worktree/stash-push', { worktreePath, message, files }),
    stashList: (worktreePath: string) =>
      transport.post('/api/worktree/stash-list', { worktreePath }),
    stashApply: (worktreePath: string, stashIndex: number, pop?: boolean) =>
      transport.post('/api/worktree/stash-apply', { worktreePath, stashIndex, pop }),
    stashDrop: (worktreePath: string, stashIndex: number) =>
      transport.post('/api/worktree/stash-drop', { worktreePath, stashIndex }),
    cherryPick: (worktreePath: string, commitHashes: string[], options?: { noCommit?: boolean }) =>
      transport.post('/api/worktree/cherry-pick', { worktreePath, commitHashes, options }),
    rebase: (worktreePath: string, ontoBranch: string, remote?: string) =>
      transport.post('/api/worktree/rebase', { worktreePath, ontoBranch, remote }),
    abortOperation: (worktreePath: string) =>
      transport.post('/api/worktree/abort-operation', { worktreePath }),
    continueOperation: (worktreePath: string) =>
      transport.post('/api/worktree/continue-operation', { worktreePath }),
    getBranchCommitLog: (worktreePath: string, branchName?: string, limit?: number) =>
      transport.post('/api/worktree/branch-commit-log', { worktreePath, branchName, limit }),
    getTestLogs: (worktreePath?: string, sessionId?: string): Promise<TestLogsResponse> => {
      const params = new URLSearchParams();
      if (worktreePath) params.append('worktreePath', worktreePath);
      if (sessionId) params.append('sessionId', sessionId);
      return transport.get(`/api/worktree/test-logs?${params.toString()}`);
    },
    onTestRunnerEvent: (callback: (event: TestRunnerEvent) => void) => {
      const unsub1 = transport.subscribeToEvent('test-runner:started', (payload) =>
        callback({ type: 'test-runner:started', payload: payload as TestRunnerStartedEvent })
      );
      const unsub2 = transport.subscribeToEvent('test-runner:output', (payload) =>
        callback({ type: 'test-runner:output', payload: payload as TestRunnerOutputEvent })
      );
      const unsub3 = transport.subscribeToEvent('test-runner:completed', (payload) =>
        callback({ type: 'test-runner:completed', payload: payload as TestRunnerCompletedEvent })
      );
      return () => {
        unsub1();
        unsub2();
        unsub3();
      };
    },
  };
}
