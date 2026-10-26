/** Only these POST contracts accept a pinned execution target. Reads resolve their own target. */
const targetAwarePosts = new Set([
  '/api/git/stage-files',
  ...[
    'stage-files',
    'commit',
    'abort-operation',
    'continue-operation',
    'add-remote',
    'set-tracking',
    'stash-push',
    'stash-apply',
    'stash-drop',
    'checkout-branch',
    'switch-branch',
    'discard-changes',
    'pull',
    'push',
    'sync',
    'rebase',
    'cherry-pick',
    'merge',
    'create',
    'delete',
    'run-init-script',
    'create-pr',
    'update-pr-number',
    'start-dev',
    'start-tests',
  ].map((action) => `/api/worktree/${action}`),
]);

export function withGitEnvironmentTarget(
  method: 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body: unknown,
  targets: ReadonlyMap<string, string>
): unknown {
  const acceptsTarget =
    method === 'POST' ? targetAwarePosts.has(endpoint) : endpoint === '/api/worktree/init-script';
  if (!acceptsTarget || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  const source = body as Record<string, unknown>;
  // An explicitly inspected target, including an empty Local target, takes precedence.
  if (source.environmentTargetId !== undefined) return body;
  const alias = source.worktreePath ?? source.projectPath;
  const target = typeof alias === 'string' ? targets.get(alias) : undefined;
  return target ? { ...source, environmentTargetId: target } : body;
}
