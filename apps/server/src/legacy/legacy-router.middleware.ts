import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { LegacyApplication } from '../legacy-application.js';
import { LEGACY_APPLICATION } from './legacy.tokens.js';

export type RouteOwner = 'legacy' | 'nest';

export const ROUTE_GROUP_OWNERS: Readonly<Record<string, RouteOwner>> = {
  health: 'legacy',
  auth: 'legacy',
  setup: 'legacy',
  fs: 'legacy',
  agent: 'legacy',
  sessions: 'legacy',
  features: 'legacy',
  'auto-mode': 'legacy',
  'enhance-prompt': 'legacy',
  worktree: 'legacy',
  git: 'legacy',
  models: 'legacy',
  'spec-regeneration': 'legacy',
  'running-agents': 'legacy',
  workspace: 'legacy',
  templates: 'legacy',
  terminal: 'legacy',
  settings: 'legacy',
  claude: 'legacy',
  codex: 'legacy',
  zai: 'legacy',
  gemini: 'legacy',
  github: 'legacy',
  context: 'legacy',
  'backlog-plan': 'legacy',
  mcp: 'legacy',
  pipeline: 'legacy',
  ideation: 'legacy',
  notifications: 'legacy',
  'event-history': 'legacy',
  projects: 'legacy',
};

export const NEST_OWNED_ROUTE_PATHS = new Set([
  '/api/health/live',
  '/api/health/ready',
  '/api/health/detailed',
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
    if (NEST_OWNED_ROUTE_PATHS.has(pathname) || (group && ROUTE_GROUP_OWNERS[group] === 'nest')) {
      next();
      return;
    }

    this.legacy.app(request, response, next);
  }
}
