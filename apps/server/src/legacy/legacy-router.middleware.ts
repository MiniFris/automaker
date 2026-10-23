import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { LegacyApplication } from '../legacy-application.js';
import { LEGACY_APPLICATION } from './legacy.tokens.js';

export type RouteOwner = 'legacy' | 'nest';

export const ROUTE_GROUP_OWNERS: Readonly<Record<string, RouteOwner>> = {
  health: 'nest',
  auth: 'nest',
  setup: 'legacy',
  fs: 'nest',
  agent: 'legacy',
  sessions: 'nest',
  features: 'nest',
  'auto-mode': 'legacy',
  'enhance-prompt': 'legacy',
  worktree: 'legacy',
  git: 'nest',
  models: 'nest',
  'spec-regeneration': 'nest',
  'running-agents': 'legacy',
  workspace: 'nest',
  templates: 'nest',
  terminal: 'legacy',
  settings: 'nest',
  claude: 'legacy',
  codex: 'legacy',
  zai: 'legacy',
  gemini: 'legacy',
  github: 'legacy',
  context: 'nest',
  'backlog-plan': 'nest',
  mcp: 'legacy',
  pipeline: 'legacy',
  ideation: 'nest',
  notifications: 'nest',
  'event-history': 'nest',
  projects: 'nest',
};

export const NEST_OWNED_ROUTE_PATHS = new Set<string>([
  'POST /api/worktree/environment',
  'POST /api/worktree/list',
  'POST /api/worktree/info',
  'POST /api/worktree/status',
  'POST /api/worktree/diffs',
  'POST /api/worktree/file-diff',
  'POST /api/worktree/check-changes',
  'POST /api/worktree/list-branches',
  'POST /api/worktree/list-remotes',
  'POST /api/worktree/stage-files',
  'POST /api/worktree/commit',
  'POST /api/worktree/start-dev',
  'POST /api/worktree/stop-dev',
  'POST /api/worktree/list-dev-servers',
  'GET /api/worktree/dev-server-logs',
  'POST /api/worktree/start-tests',
  'POST /api/worktree/stop-tests',
  'GET /api/worktree/test-logs',
  'POST /api/worktree/abort-operation',
  'POST /api/worktree/continue-operation',
  'POST /api/worktree/add-remote',
  'POST /api/worktree/set-tracking',
  'POST /api/worktree/stash-list',
  'POST /api/worktree/stash-push',
  'POST /api/worktree/stash-apply',
  'POST /api/worktree/stash-drop',
  'POST /api/worktree/checkout-branch',
  'POST /api/worktree/switch-branch',
  'POST /api/worktree/discard-changes',
  'POST /api/worktree/pull',
  'POST /api/worktree/push',
  'POST /api/worktree/sync',
  'POST /api/worktree/rebase',
  'POST /api/worktree/cherry-pick',
  'POST /api/worktree/merge',
  'POST /api/worktree/create',
  'POST /api/worktree/delete',
  'POST /api/worktree/init-git',
  'GET /api/worktree/init-script',
  'PUT /api/worktree/init-script',
  'DELETE /api/worktree/init-script',
  'POST /api/worktree/run-init-script',
  'POST /api/worktree/migrate',
  'POST /api/worktree/commit-log',
  'POST /api/worktree/branch-commit-log',
  'GET /api/settings/status',
  'GET /api/settings/global',
  'GET /api/settings/credentials',
  'POST /api/settings/project',
  'POST /api/settings/agents/discover',
  'GET /api/settings/model-timeouts',
  'GET /api/settings/openai-compatible',
  'PUT /api/settings/global',
  'PUT /api/settings/credentials',
  'PUT /api/settings/project',
  'POST /api/settings/migrate',
  'PUT /api/settings/model-timeouts',
  'PUT /api/settings/openai-compatible/endpoint',
  'POST /api/settings/openai-compatible/remove',
  'PUT /api/settings/openai-compatible/agent',
  'POST /api/settings/openai-compatible/models',
  'POST /api/settings/openai-compatible/test',
  'POST /api/settings/execution-environments/inspect',
  'POST /api/settings/execution-environments/feature/inspect',
  'PUT /api/settings/execution-environments/global',
  'PUT /api/settings/execution-environments/project',
  'POST /api/settings/execution-environments/local/confirm',
  'POST /api/settings/execution-environments/local/revoke',
  'POST /api/settings/execution-environments/auto/confirm',
  'POST /api/settings/execution-environments/auto/revoke',
  'POST /api/settings/execution-environments/docker/check',
  'POST /api/settings/execution-environments/docker/prepare',
  'POST /api/settings/execution-environments/providers/inspect',
  'POST /api/settings/execution-environments/providers/install',
  'POST /api/settings/execution-environments/providers/key',
  'POST /api/settings/execution-environments/ssh/scan',
  'POST /api/settings/execution-environments/ssh/trust',
  'POST /api/settings/execution-environments/ssh/key',
  'POST /api/settings/execution-environments/ssh/check',
  'POST /api/settings/execution-environments/ssh/prepare',
  'POST /api/settings/execution-environments/ssh/project',
  'POST /api/settings/execution-environments/ssh/recover',
  'POST /api/fs/read',
  'POST /api/fs/readdir',
  'POST /api/fs/stat',
  'POST /api/fs/exists',
  'POST /api/fs/write',
  'POST /api/fs/mkdir',
  'POST /api/fs/delete',
  'POST /api/fs/copy',
  'POST /api/fs/move',
  'POST /api/fs/validate-path',
  'POST /api/fs/browse',
  'POST /api/fs/browse-project-files',
  'POST /api/fs/resolve-directory',
  'POST /api/fs/save-image',
  'POST /api/fs/save-board-background',
  'POST /api/fs/delete-board-background',
  'GET /api/fs/image',
  'POST /api/fs/download',
  'GET /api/features/list',
  'POST /api/features/list',
  'POST /api/features/get',
  'POST /api/features/agent-output',
  'POST /api/features/raw-output',
  'POST /api/features/export',
  'POST /api/features/check-conflicts',
  'POST /api/features/orphaned',
  'POST /api/features/create',
  'POST /api/features/update',
  'POST /api/features/delete',
  'POST /api/features/bulk-update',
  'POST /api/features/bulk-delete',
  'POST /api/features/import',
  'POST /api/features/orphaned/resolve',
  'POST /api/features/orphaned/bulk-resolve',
  'POST /api/features/generate-title',
]);

export function getApiRouteGroup(request: Pick<Request, 'originalUrl'>): string | undefined {
  const pathname = request.originalUrl.split(/[?#]/, 1)[0];
  const match = /^\/api(?:\/([^/]+))?(?:\/|$)/.exec(pathname);
  return match?.[1];
}

export function assertSingleRouteOwner(owners: Record<string, RouteOwner>): void {
  for (const [group, owner] of Object.entries(owners)) {
    if (!group || (owner !== 'legacy' && owner !== 'nest')) {
      throw new Error(`Invalid owner for API route group "${group}": ${String(owner)}`);
    }
  }
}

@Injectable()
export class LegacyRouterMiddleware implements NestMiddleware {
  constructor(@Inject(LEGACY_APPLICATION) private readonly legacy: LegacyApplication) {
    assertSingleRouteOwner(ROUTE_GROUP_OWNERS);
  }

  use(request: Request, response: Response, next: NextFunction): void {
    const group = getApiRouteGroup(request);
    const pathname = request.originalUrl.split(/[?#]/, 1)[0];
    if (
      NEST_OWNED_ROUTE_PATHS.has(`${request.method} ${pathname}`) ||
      (['GET', 'PUT'].includes(request.method) &&
        pathname.startsWith('/api/settings/model-timeouts/')) ||
      (group && ROUTE_GROUP_OWNERS[group] === 'nest')
    ) {
      next();
      return;
    }

    this.legacy.app(request, response, next);
  }
}
