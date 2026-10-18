import type { Request, Response, NextFunction } from 'express';
import type { SettingsService } from '../services/settings-service.js';
import {
  ProjectGitService,
  gitReadActions,
  gitWriteActions,
} from '../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../services/execution-environment/runtime.js';
import { sshSerialized } from '../services/execution-environment/ssh-state.js';

/** Must run before legacy path/worktree middleware, which only understands controller Git. */
export function environmentGitDispatcher(
  settings: SettingsService,
  scope: 'git' | 'worktree',
  isProjectBusy?: (projectPath: string) => boolean | Promise<boolean>
) {
  const service = new ProjectGitService(settings);
  return async (req: Request, res: Response, next: NextFunction) => {
    const action = req.path.slice(1),
      body = (req.method === 'GET' ? req.query : req.body) as Record<string, unknown> | undefined;
    const requested = body?.worktreePath ?? body?.projectPath;
    if (typeof requested !== 'string') {
      next();
      return;
    }
    const controller = new AbortController();
    const closed = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', closed);
    try {
      const featureId =
        scope === 'worktree' &&
        ['info', 'status', 'diffs', 'file-diff'].includes(action) &&
        typeof body?.featureId === 'string'
          ? body.featureId
          : undefined;
      const target = await service.resolve(requested, featureId);
      if (action === 'environment') {
        res.json({
          success: true,
          executionEnvironment: target?.environment ?? {
            type: 'local',
            path: requested,
            projectPath: requested,
            runtimeCwd: requested,
            root: requested,
            pinned: false,
            targetId: '',
            legacy: true,
          },
        });
        return;
      }
      if (!target) {
        if (body?.environmentTargetId && !gitReadActions.has(action))
          throw new ExecutionEnvironmentError(
            'GIT_TARGET_CHANGED',
            'The previously inspected remote target is now Local/legacy. Inspect the Local working copy before changing it; no controller mutation was dispatched.'
          );
        const originalJson = res.json.bind(res);
        res.json = ((value: unknown) => {
          const data = value as { success?: boolean; executionEnvironment?: unknown };
          if (data.success)
            data.executionEnvironment = {
              type: 'local',
              path: requested,
              projectPath: requested,
              runtimeCwd: requested,
              root: requested,
              pinned: false,
              targetId: '',
              legacy: true,
            };
          return originalJson(value);
        }) as Response['json'];
        // Preserve old remote feature worktrees in the selector after a default change to Local.
        if (scope === 'worktree' && action === 'list') {
          const extras = await service.pinnedEntries(requested);
          const original = res.json.bind(res);
          res.json = ((value: unknown) => {
            const data = value as { success?: boolean; worktrees?: Array<{ path: string }> };
            if (data.success && Array.isArray(data.worktrees))
              data.worktrees = [
                ...data.worktrees.filter(
                  (item) => !extras.some((extra) => extra.path === item.path)
                ),
                ...extras,
              ];
            return original(value);
          }) as Response['json'];
        }
        next();
        return;
      }
      if (
        req.method !== 'POST' ||
        (scope === 'git' &&
          !['diffs', 'file-diff', 'enhanced-status', 'details', 'stage-files'].includes(action))
      )
        throw new ExecutionEnvironmentError(
          'GIT_OPERATION_UNSUPPORTED',
          'This method/route is not supported for managed Git. No controller operation was performed.'
        );
      const work = async () => {
        if (gitWriteActions.has(action) && (await isProjectBusy?.(target.environment.projectPath)))
          throw new ExecutionEnvironmentError(
            'GIT_PROJECT_BUSY',
            'Stop active project features before changing Git state from the UI.'
          );
        return service.run(target, action, body ?? {}, controller.signal);
      };
      const result = gitWriteActions.has(action)
        ? await sshSerialized('git-ui\0' + target.environment.projectPath, work)
        : await work();
      res.json(result);
    } catch (error) {
      if (!res.headersSent)
        res.status(400).json({
          success: false,
          code:
            error instanceof ExecutionEnvironmentError ? error.code : 'GIT_ENVIRONMENT_UNAVAILABLE',
          error:
            error instanceof Error
              ? error.message
              : 'Environment Git failed. No host fallback was used.',
        });
    } finally {
      res.off('close', closed);
    }
  };
}
