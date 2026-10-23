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
  git: 'legacy',
  models: 'nest',
  'spec-regeneration': 'legacy',
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
  'backlog-plan': 'legacy',
  mcp: 'legacy',
  pipeline: 'legacy',
  ideation: 'legacy',
  notifications: 'nest',
  'event-history': 'nest',
  projects: 'nest',
};

export const NEST_OWNED_ROUTE_PATHS = new Set<string>([
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
