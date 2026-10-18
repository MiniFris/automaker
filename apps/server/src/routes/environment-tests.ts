import type { Request, Response, NextFunction } from 'express';
import type { SettingsService } from '../services/settings-service.js';
import type { EventEmitter } from '../lib/events.js';
import { ProjectGitService } from '../services/execution-environment/project-git.js';
import { getManagedTestRunnerService } from '../services/execution-environment/test-runner.js';
import { ExecutionEnvironmentError } from '../services/execution-environment/runtime.js';
import { getTestRunnerService } from '../services/test-runner-service.js';
import { createGetTestLogsHandler } from './worktree/routes/test-logs.js';

/** Before controller path validators/Git dispatcher: an SSH workspace is not a host path.
 * Session IDs take precedence over current defaults; unknown managed IDs never reach legacy.
 */
export function environmentTestDispatcher(settings: SettingsService, events: EventEmitter) {
  const git = new ProjectGitService(settings);
  const tests = getManagedTestRunnerService(settings, events);
  return async (req: Request, res: Response, next: NextFunction) => {
    const action = req.path.slice(1);
    if (!['start-tests', 'stop-tests', 'test-logs'].includes(action)) return next();
    const body = (req.method === 'GET' ? req.query : req.body) as
      | Record<string, unknown>
      | undefined;
    try {
      if (req.method !== (action === 'test-logs' ? 'GET' : 'POST')) {
        res.status(405).json({ success: false, error: 'Unsupported test runner method.' });
        return;
      }
      const id = body?.sessionId;
      const requested = body?.worktreePath;
      if (
        (id !== undefined && (typeof id !== 'string' || !id)) ||
        (requested !== undefined && (typeof requested !== 'string' || !requested))
      )
        throw new ExecutionEnvironmentError(
          'TEST_REQUEST_INVALID',
          'sessionId/worktreePath must be nonempty strings.'
        );
      if (typeof id === 'string' && tests.owns(id)) {
        if (action === 'stop-tests') {
          res.json({ success: true, result: await tests.stop(id) });
          return;
        }
        if (action === 'test-logs') {
          const session = tests.find(typeof requested === 'string' ? requested : undefined, id);
          if (!session)
            throw new ExecutionEnvironmentError(
              'TEST_SESSION_GONE',
              'Managed test session not found (expired or backend restarted). No test was recreated or replayed.'
            );
          res.json({ success: true, result: tests.describe(session) });
          return;
        }
      }
      if (action === 'stop-tests' || (action === 'test-logs' && id)) return next();
      if (typeof requested !== 'string') {
        if (action === 'start-tests')
          throw new ExecutionEnvironmentError('TEST_REQUEST_INVALID', 'worktreePath is required.');
        return next();
      }
      // Keep active/history reads on their captured target even after profile deletion/default changes.
      const previous = tests.find(requested);
      const managedActive = previous && ['pending', 'running'].includes(previous.status);
      const localActive = getTestRunnerService().getActiveSession(requested);
      if (action === 'test-logs') {
        const localLatest = getTestRunnerService().listSessions(requested).result.sessions.at(-1);
        if (
          !managedActive &&
          (localActive ||
            (localLatest &&
              (!previous || Date.parse(localLatest.startedAt) > Date.parse(previous.startedAt))))
        ) {
          await createGetTestLogsHandler()(req, res);
          return;
        }
        const session = previous;
        if (session) {
          res.json({ success: true, result: tests.describe(session) });
          return;
        }
      }
      if (action === 'start-tests' && managedActive)
        throw new ExecutionEnvironmentError(
          'TEST_ALREADY_RUNNING',
          'Stop the existing managed test session before starting another run in this workspace.'
        );
      const target = await git.resolve(requested);
      if (!target) {
        if (action === 'start-tests' && body?.environmentTargetId)
          throw new ExecutionEnvironmentError(
            'TEST_TARGET_CHANGED',
            'The inspected remote workspace is now Local/legacy. Inspect it again before starting tests. No host command was started.'
          );
        return next();
      }
      if (action === 'test-logs') {
        res.status(404).json({
          success: false,
          code: 'TEST_SESSION_GONE',
          error:
            'No managed test session exists for this workspace. Backend restart does not recreate or replay tests.',
        });
        return;
      }
      if (localActive)
        throw new ExecutionEnvironmentError(
          'TEST_ALREADY_RUNNING',
          'Stop the existing Local test session before starting tests in the selected environment.'
        );
      res.json({
        success: true,
        result: await tests.start(target, body?.environmentTargetId, body?.testFile),
      });
    } catch (error) {
      const code =
        error instanceof ExecutionEnvironmentError ? error.code : 'TEST_ENVIRONMENT_FAILED';
      res
        .status(code === 'TEST_SESSION_GONE' ? 404 : code === 'TEST_CLEANUP_UNVERIFIED' ? 409 : 400)
        .json({
          success: false,
          code,
          error:
            error instanceof Error
              ? error.message
              : 'Target tests failed. No host fallback or replay occurred.',
        });
    }
  };
}
