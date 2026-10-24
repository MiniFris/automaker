import type { Request, Response, NextFunction } from 'express';
import type { SettingsService } from '../services/settings-service.js';
import { ProjectGitService } from '../services/execution-environment/project-git.js';
import type { ManagedDevServerService } from '../services/execution-environment/dev-server.js';
import { ExecutionEnvironmentError } from '../services/execution-environment/runtime.js';
import type { DevServerService } from '../services/dev-server-service.js';
import { createStopDevHandler } from './worktree/routes/stop-dev.js';
import { createGetDevServerLogsHandler } from './worktree/routes/dev-server-logs.js';

export function environmentDevDispatcher(
  settings: SettingsService,
  service: ManagedDevServerService,
  local: DevServerService
) {
  const git = new ProjectGitService(settings);
  return async (req: Request, res: Response, next: NextFunction) => {
    const action = req.path.slice(1);
    if (!['start-dev', 'stop-dev', 'list-dev-servers', 'dev-server-logs'].includes(action))
      return next();
    const body = (req.method === 'GET' ? req.query : req.body) as
      | Record<string, unknown>
      | undefined;
    try {
      if (req.method !== (action === 'dev-server-logs' ? 'GET' : 'POST')) {
        res.status(405).json({ success: false, error: 'Unsupported dev server method.' });
        return;
      }
      if (action === 'list-dev-servers') {
        const managed = service.list();
        const legacy = local
          .listDevServers()
          .result.servers.filter((s) => !managed.some((m) => m.worktreePath === s.worktreePath));
        res.json({ success: true, result: { servers: [...legacy, ...managed] } });
        return;
      }
      const alias = body?.worktreePath,
        id = body?.sessionId;
      if (
        (id !== undefined && (typeof id !== 'string' || !id)) ||
        (alias !== undefined && (typeof alias !== 'string' || !alias))
      )
        throw new ExecutionEnvironmentError(
          'DEV_REQUEST_INVALID',
          'worktreePath/sessionId must be nonempty strings.'
        );
      if (typeof id === 'string' && service.owns(id)) {
        const session = service.find(undefined, id);
        if (!session || (alias && alias !== session.target.environment.path))
          throw new ExecutionEnvironmentError(
            'DEV_SESSION_GONE',
            'Managed dev session expired or backend restarted. It was not recreated or replayed.'
          );
        if (action === 'stop-dev') {
          res.json({ success: true, result: await service.stop(id) });
          return;
        }
        if (action === 'dev-server-logs') {
          res.json({ success: true, result: service.describe(session) });
          return;
        }
      } else if (id !== undefined)
        throw new ExecutionEnvironmentError('DEV_SESSION_GONE', 'Unknown managed dev session ID.');
      if (typeof alias !== 'string')
        throw new ExecutionEnvironmentError('DEV_REQUEST_INVALID', 'worktreePath is required.');
      const previous = service.find(alias),
        legacy = local.isRunning(alias);
      if (action === 'dev-server-logs') {
        if (legacy && (!previous || previous.finished)) {
          await createGetDevServerLogsHandler(local)(req, res);
          return;
        }
        if (previous) {
          res.json({ success: true, result: service.describe(previous) });
          return;
        }
      }
      if (action === 'stop-dev') {
        if (legacy && (!previous || previous.finished)) {
          await createStopDevHandler(local)(req, res);
          return;
        }
        if (previous)
          throw new ExecutionEnvironmentError(
            'DEV_SESSION_ID_REQUIRED',
            'Stop requires the captured managed dev sessionId, not a newly resolved workspace target. Refresh the server list.'
          );
      }
      if (action === 'start-dev' && previous && !previous.finished)
        throw new ExecutionEnvironmentError(
          'DEV_ALREADY_RUNNING',
          'Stop the existing managed session before starting another dev server.'
        );
      const target = await git.resolve(alias);
      if (!target) {
        if (action === 'start-dev' && body?.environmentTargetId)
          throw new ExecutionEnvironmentError(
            'DEV_TARGET_CHANGED',
            'The inspected remote target is now Local/legacy. Inspect again; no host command was started.'
          );
        return next();
      }
      if (action !== 'start-dev')
        throw new ExecutionEnvironmentError(
          'DEV_SESSION_GONE',
          'No managed dev session exists. Backend restart never recreates dev processes.'
        );
      if (legacy)
        throw new ExecutionEnvironmentError(
          'DEV_ALREADY_RUNNING',
          'Stop the existing Local dev server before starting one in a managed environment.'
        );
      res.json({ success: true, result: await service.start(target, body?.environmentTargetId) });
    } catch (error) {
      const code =
        error instanceof ExecutionEnvironmentError ? error.code : 'DEV_ENVIRONMENT_FAILED';
      res
        .status(code === 'DEV_SESSION_GONE' ? 404 : code === 'DEV_CLEANUP_UNVERIFIED' ? 409 : 400)
        .json({
          success: false,
          code,
          error:
            error instanceof Error
              ? error.message
              : 'Dev server failed. No host fallback or replay occurred.',
        });
    }
  };
}
