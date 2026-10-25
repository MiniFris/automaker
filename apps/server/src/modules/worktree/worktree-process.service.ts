import { Inject, Injectable } from '@nestjs/common';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { DevServerService } from '../../services/dev-server-service.js';
import { ManagedDevServerService } from '../../services/execution-environment/dev-server.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import { ManagedTestRunnerService } from '../../services/execution-environment/test-runner.js';
import { SettingsService } from '../../services/settings-service.js';
import { TestRunnerService } from '../../services/test-runner-service.js';
import type {
  DevSessionRequest,
  StartDevRequest,
  StartTestsRequest,
  StopTestsRequest,
  TestLogsRequest,
} from './worktree.schemas.js';

@Injectable()
export class WorktreeProcessService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProjectGitService) private readonly git: ProjectGitService,
    @Inject(ManagedDevServerService) private readonly managedDev: ManagedDevServerService,
    @Inject(ManagedTestRunnerService) private readonly managedTests: ManagedTestRunnerService,
    @Inject(DevServerService)
    private readonly localDev: DevServerService,
    @Inject(TestRunnerService)
    private readonly localTests: TestRunnerService
  ) {}

  async startDev(input: StartDevRequest) {
    const previous = this.managedDev.find(input.worktreePath);
    if (previous && !previous.finished)
      throw new ExecutionEnvironmentError(
        'DEV_ALREADY_RUNNING',
        'Stop the existing managed session before starting another dev server.'
      );
    const target = await this.git.resolve(input.worktreePath);
    if (target) {
      if (this.localDev.isRunning(input.worktreePath))
        throw new ExecutionEnvironmentError(
          'DEV_ALREADY_RUNNING',
          'Stop the existing Local dev server before starting one in a managed environment.'
        );
      return {
        success: true as const,
        result: await this.managedDev.start(target, input.environmentTargetId),
      };
    }
    if (input.environmentTargetId)
      throw new ExecutionEnvironmentError(
        'DEV_TARGET_CHANGED',
        'The inspected remote target is now Local. Inspect it again; no host command was started.'
      );
    const settings = await this.settings.getProjectSettings(input.projectPath);
    const result = await this.localDev.startDevServer(
      input.projectPath,
      input.worktreePath,
      settings.devCommand?.trim() || undefined
    );
    if (!result.success || !result.result)
      throw new ValidationDomainError(result.error || 'Failed to start dev server');
    return { success: true as const, result: result.result };
  }

  async stopDev(input: DevSessionRequest) {
    if (input.sessionId) {
      if (!this.managedDev.owns(input.sessionId))
        throw new ExecutionEnvironmentError(
          'DEV_SESSION_GONE',
          'Unknown managed dev session ID.',
          404
        );
      const session = this.managedDev.find(undefined, input.sessionId);
      if (
        !session ||
        (input.worktreePath && input.worktreePath !== session.target.environment.path)
      )
        throw new ExecutionEnvironmentError(
          'DEV_SESSION_GONE',
          'Managed dev session expired or backend restarted.',
          404
        );
      return { success: true as const, result: await this.managedDev.stop(input.sessionId) };
    }
    const managed = this.managedDev.find(input.worktreePath);
    if (managed && !managed.finished)
      throw new ExecutionEnvironmentError(
        'DEV_SESSION_ID_REQUIRED',
        'Stop requires the captured managed dev sessionId. Refresh the server list.'
      );
    const result = await this.localDev.stopDevServer(input.worktreePath!);
    if (!result.success || !result.result)
      throw new ValidationDomainError(result.error || 'Failed to stop dev server');
    return { success: true as const, result: result.result };
  }

  listDev() {
    const managed = this.managedDev.list();
    const local = this.localDev
      .listDevServers()
      .result.servers.filter(
        (server) => !managed.some((item) => item.worktreePath === server.worktreePath)
      );
    return { success: true as const, result: { servers: [...local, ...managed] } };
  }

  devLogs(input: DevSessionRequest) {
    if (input.sessionId) {
      if (!this.managedDev.owns(input.sessionId))
        throw new ExecutionEnvironmentError(
          'DEV_SESSION_GONE',
          'Unknown managed dev session ID.',
          404
        );
      const session = this.managedDev.find(input.worktreePath, input.sessionId);
      if (!session)
        throw new ExecutionEnvironmentError(
          'DEV_SESSION_GONE',
          'Managed dev session expired or moved.',
          404
        );
      return { success: true as const, result: this.managedDev.describe(session) };
    }
    const managed = this.managedDev.find(input.worktreePath);
    const localRunning = this.localDev.isRunning(input.worktreePath!);
    if (managed && (!localRunning || !managed.finished))
      return { success: true as const, result: this.managedDev.describe(managed) };
    const result = this.localDev.getServerLogs(input.worktreePath!);
    if (!result.success || !result.result)
      throw new NotFoundDomainError(result.error || 'Failed to get dev server logs');
    return { success: true as const, result: result.result };
  }

  async startTests(input: StartTestsRequest) {
    const managedPrevious = this.managedTests.find(input.worktreePath);
    if (managedPrevious && ['pending', 'running'].includes(managedPrevious.status))
      throw new ExecutionEnvironmentError(
        'TEST_ALREADY_RUNNING',
        'Stop the existing managed test session before starting another run.'
      );
    const target = await this.git.resolve(input.worktreePath);
    if (target) {
      if (this.localTests.getActiveSession(input.worktreePath))
        throw new ExecutionEnvironmentError(
          'TEST_ALREADY_RUNNING',
          'Stop the existing Local test session before starting tests in the selected environment.'
        );
      return {
        success: true as const,
        result: await this.managedTests.start(target, input.environmentTargetId, input.testFile),
      };
    }
    if (input.environmentTargetId)
      throw new ExecutionEnvironmentError(
        'TEST_TARGET_CHANGED',
        'The inspected remote target is now Local. Inspect it again before starting tests.'
      );
    const settingsPath = input.projectPath ?? input.worktreePath;
    const command = (await this.settings.getProjectSettings(settingsPath)).testCommand;
    if (!command)
      throw new ValidationDomainError(
        'No test command configured. Configure it in Project Settings.'
      );
    const result = await this.localTests.startTests(input.worktreePath, {
      command,
      testFile: input.testFile,
    });
    if (!result.success || !result.result)
      throw new ValidationDomainError(result.error || 'Failed to start tests');
    return { success: true as const, result: result.result };
  }

  async stopTests(input: StopTestsRequest) {
    if (this.managedTests.owns(input.sessionId))
      return { success: true as const, result: await this.managedTests.stop(input.sessionId) };
    const result = await this.localTests.stopTests(input.sessionId);
    if (!result.success || !result.result)
      throw new ValidationDomainError(result.error || 'Failed to stop tests');
    return { success: true as const, result: result.result };
  }

  testLogs(input: TestLogsRequest) {
    if (input.sessionId && this.managedTests.owns(input.sessionId)) {
      const session = this.managedTests.find(input.worktreePath, input.sessionId);
      if (!session)
        throw new ExecutionEnvironmentError(
          'TEST_SESSION_GONE',
          'Managed test session expired or moved.',
          404
        );
      return { success: true as const, result: this.managedTests.describe(session) };
    }
    const managed = input.worktreePath
      ? this.managedTests.find(input.worktreePath, input.sessionId)
      : undefined;
    const local = this.localTestSession(input);
    if (managed && (!local || Date.parse(managed.startedAt) >= Date.parse(local.session.startedAt)))
      return { success: true as const, result: this.managedTests.describe(managed) };
    if (!local) throw new NotFoundDomainError('No test sessions found for this worktree');
    const output = this.localTests.getSessionOutput(local.session.sessionId);
    if (!output.success || !output.result)
      throw new NotFoundDomainError(output.error || 'Failed to get test logs');
    return {
      success: true as const,
      result: {
        sessionId: local.session.sessionId,
        worktreePath: local.session.worktreePath,
        command: local.session.command,
        status: output.result.status,
        testFile: local.session.testFile,
        logs: output.result.output,
        startedAt: output.result.startedAt,
        finishedAt: output.result.finishedAt,
        exitCode: local.session.exitCode ?? null,
      },
    };
  }

  private localTestSession(input: TestLogsRequest) {
    if (input.sessionId) {
      const session = this.localTests.getSession(input.sessionId);
      return session
        ? {
            session: {
              sessionId: session.id,
              worktreePath: session.worktreePath,
              command: session.command,
              testFile: session.testFile,
              startedAt: session.startedAt.toISOString(),
              exitCode: session.exitCode,
            },
          }
        : undefined;
    }
    const active = this.localTests.getActiveSession(input.worktreePath!);
    if (active)
      return {
        session: {
          sessionId: active.id,
          worktreePath: active.worktreePath,
          command: active.command,
          testFile: active.testFile,
          startedAt: active.startedAt.toISOString(),
          exitCode: active.exitCode,
        },
      };
    const sessions = this.localTests.listSessions(input.worktreePath!).result.sessions;
    const session = sessions.reduce<(typeof sessions)[number] | undefined>(
      (latest, current) =>
        !latest || Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
      undefined
    );
    return session ? { session } : undefined;
  }
}
