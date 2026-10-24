import { expect, it, vi } from 'vitest';
import { GithubCliCommentsAdapter } from '../../../src/modules/github/github-cli-comments.adapter.js';
import { GithubCliReviewMutationAdapter } from '../../../src/modules/github/github-cli-review-mutation.adapter.js';
import { GithubCommandError } from '../../../src/modules/github/github-command.runtime.js';
const remote = {
  hasGitHubRemote: true,
  remoteUrl: null,
  owner: 'owned',
  repo: 'repo.v2',
  hostname: 'enterprise.test',
};
const active = () => new AbortController().signal;
const reply = (data: unknown) => ({ stdout: JSON.stringify({ data }) });
const row = {
  id: 1,
  user: null,
  performed_via_github_app: { slug: 'owned-bot' },
  body: 'Owned comment',
  created_at: '2026-10-01T00:00:00Z',
};
function target(resolved = false, extra: Record<string, unknown> = {}) {
  return {
    repository: { id: 'R_owned', nameWithOwner: 'owned/repo.v2' },
    node: {
      __typename: 'PullRequestReviewThread',
      id: 'PRRT_owned',
      repository: { id: 'R_owned', nameWithOwner: 'owned/repo.v2' },
      isResolved: resolved,
      viewerCanResolve: true,
      viewerCanUnresolve: true,
      ...extra,
    },
  };
}
const rest = (command: { args: string[] }) =>
  command.args[1].includes('/reviews?') ? { stdout: '[]' } : { stdout: JSON.stringify([row]) };

it('binds issue pagination variables/hostname and preserves deleted-author fallback', async () => {
  const run = vi.fn().mockResolvedValue(
    reply({
      repository: {
        issueOrPullRequest: {
          comments: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: 'C_owned', author: null, body: 'Owned', createdAt: row.created_at }],
          },
        },
      },
    })
  );
  const result = await new GithubCliCommentsAdapter({ run }).issueComments(
    '/project',
    remote,
    12,
    'cursor_2',
    active()
  );
  expect(result.comments[0].author.login).toBe('ghost');
  const call = run.mock.calls[0][0];
  expect(call.args).toEqual(['api', 'graphql', '--hostname', 'enterprise.test', '--input', '-']);
  expect(JSON.parse(call.input).variables).toEqual({
    owner: 'owned',
    repo: 'repo.v2',
    issueNumber: 12,
    cursor: 'cursor_2',
  });
  expect(JSON.parse(call.input).query).not.toContain('repo.v2');
});

it('uses bounded REST pages rather than concatenated --paginate JSON and omits unknown thread resolution', async () => {
  const run = vi.fn(async (command) => {
    if (command.args[1] === 'graphql') throw new GithubCommandError('exit');
    if (command.args[1].includes('/issues/') && command.args[1].endsWith('page=1'))
      return {
        stdout: JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ ...row, id: id + 100 }))),
      };
    return rest(command);
  });
  const comments = await new GithubCliCommentsAdapter({ run }).reviewComments(
    '/project',
    remote,
    12,
    active()
  );
  expect(comments).toHaveLength(102);
  expect(comments.find((comment) => comment.isReviewComment)?.isResolved).toBeUndefined();
  expect(comments.find((comment) => comment.isReviewComment)?.threadId).toBeUndefined();
  expect(comments[0].author).toBe('owned-bot');
  expect(run.mock.calls.some(([command]) => command.args.includes('--paginate'))).toBe(false);
  expect(
    run.mock.calls
      .filter(([command]) => command.args[1] !== 'graphql')
      .every(([command]) => command.args.includes('GET'))
  ).toBe(true);
});

it.each(['cancel', 'cleanup', 'deadline', 'limit'] as const)(
  'does not hide metadata resource failure (%s)',
  async (kind) => {
    const run = vi.fn(async (command) => {
      if (command.args[1] === 'graphql') throw new GithubCommandError(kind);
      return rest(command);
    });
    await expect(
      new GithubCliCommentsAdapter({ run }).reviewComments('/project', remote, 12, active())
    ).rejects.toMatchObject({ kind });
  }
);

it('fails a mandatory catalog instead of reporting an empty success', async () => {
  const run = vi.fn().mockRejectedValue(new GithubCommandError('exit'));
  await expect(
    new GithubCliCommentsAdapter({ run }).reviewComments('/project', remote, 12, active())
  ).rejects.toMatchObject({ kind: 'exit' });
  expect(run).toHaveBeenCalledOnce();
});

it('rejects repeated REST pages without an unbounded loop', async () => {
  const run = vi.fn().mockResolvedValue({
    stdout: JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ ...row, id: id + 100 }))),
  });
  await expect(
    new GithubCliCommentsAdapter({ run }).reviewComments('/project', remote, 12, active())
  ).rejects.toThrow('invalid response');
  expect(run).toHaveBeenCalledTimes(2);
});

it.each([true, false])(
  'verifies immutable repository identity and dispatches exactly one confirmed mutation (resolve=%s)',
  async (resolve) => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(reply(target(!resolve)))
      .mockResolvedValueOnce(
        reply({
          [resolve ? 'resolveReviewThread' : 'unresolveReviewThread']: {
            thread: { id: 'PRRT_owned', isResolved: resolve },
          },
        })
      );
    expect(
      await new GithubCliReviewMutationAdapter({ run }).resolveThread(
        '/project',
        remote,
        'PRRT_owned',
        resolve,
        active()
      )
    ).toEqual({ isResolved: resolve });
    expect(run).toHaveBeenCalledTimes(2);
    for (const [command] of run.mock.calls) expect(command.args).toContain('enterprise.test');
    const mutation = JSON.parse(run.mock.calls[1][0].input);
    expect(mutation.variables).toEqual({ threadId: 'PRRT_owned' });
    expect(mutation.query).not.toContain('PRRT_owned');
  }
);

it.each([true, false])(
  'returns an authoritative no-op without mutation when already in requested state (%s)',
  async (resolve) => {
    const run = vi.fn().mockResolvedValue(reply(target(resolve)));
    expect(
      await new GithubCliReviewMutationAdapter({ run }).resolveThread(
        '/project',
        remote,
        'PRRT_owned',
        resolve,
        active()
      )
    ).toEqual({ isResolved: resolve });
    expect(run).toHaveBeenCalledOnce();
  }
);

it.each([
  { repository: { id: 'R_other', nameWithOwner: 'other/repo' } },
  { id: 'PRRT_other' },
  { viewerCanResolve: false },
])('refuses a mismatched or forbidden target before dispatch (%#)', async (extra) => {
  const run = vi.fn().mockResolvedValue(reply(target(false, extra)));
  await expect(
    new GithubCliReviewMutationAdapter({ run }).resolveThread(
      '/project',
      remote,
      'PRRT_owned',
      true,
      active()
    )
  ).rejects.toMatchObject({ errorCode: 'FORBIDDEN' });
  expect(run).toHaveBeenCalledOnce();
});

it.each(['exit', 'deadline', 'cancel', 'cleanup', 'limit'] as const)(
  'reports UNKNOWN_OUTCOME after a dispatched mutation failure (%s), without retry',
  async (kind) => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(reply(target()))
      .mockRejectedValueOnce(new GithubCommandError(kind));
    await expect(
      new GithubCliReviewMutationAdapter({ run }).resolveThread(
        '/project',
        remote,
        'PRRT_owned',
        true,
        active()
      )
    ).rejects.toMatchObject({ errorCode: 'UNKNOWN_OUTCOME' });
    expect(run).toHaveBeenCalledTimes(2);
  }
);

it.each([
  { stdout: '{' },
  reply({ resolveReviewThread: { thread: { id: 'PRRT_other', isResolved: true } } }),
])('never invents mutation success from invalid confirmation (%#)', async (response) => {
  const run = vi.fn().mockResolvedValueOnce(reply(target())).mockResolvedValueOnce(response);
  await expect(
    new GithubCliReviewMutationAdapter({ run }).resolveThread(
      '/project',
      remote,
      'PRRT_owned',
      true,
      active()
    )
  ).rejects.toMatchObject({ errorCode: 'UNKNOWN_OUTCOME' });
  expect(run).toHaveBeenCalledTimes(2);
});
