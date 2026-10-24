#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root = process.env.HOME;
if (!root || !path.basename(root).startsWith('automaker-github-profile-'))
  throw new Error('Owned fixture profile required');
const scenario = JSON.parse(readFileSync(path.join(root, 'scenario.json'), 'utf8'));
const args = process.argv.slice(2);
let input = '';
for await (const chunk of process.stdin) input += chunk;
appendFileSync(
  path.join(root, 'calls.jsonl'),
  JSON.stringify({
    args,
    input,
    cwd: process.cwd(),
    overrideAbsent: process.env.GH_REPO === undefined,
    profileToken: process.env.GH_TOKEN === 'fixture-profile-token',
  }) + '\n'
);
if (
  ['hold', 'orphan'].includes(scenario.mode) ||
  (scenario.mode === 'review-hold' && input.includes('mutation ResolveThread'))
) {
  process.on('SIGTERM', () => {});
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
  );
  child.once('message', () => {
    writeFileSync(
      path.join(root, 'pids.json'),
      JSON.stringify({ root: process.pid, child: child.pid })
    );
    if (scenario.mode === 'orphan') {
      process.stdout.write(
        JSON.stringify({
          name: 'repo.v2',
          owner: { login: 'owned' },
          url: 'https://github.com/owned/repo.v2',
        })
      );
      process.exit(0);
    }
  });
  setInterval(() => {}, 1000);
} else if (scenario.mode === 'rate') {
  process.stderr.write('HTTP 429 private-provider-credential');
  process.exitCode = 1;
} else if (scenario.mode === 'flood') {
  process.stdout.write('x'.repeat(11 * 1024 * 1024));
} else if (scenario.mode === 'malformed') process.stdout.write('{');
else if (scenario.mode === 'exit') {
  process.stderr.write('private-provider-credential');
  process.exitCode = 1;
} else if (args[0] === 'repo')
  process.stdout.write(
    JSON.stringify({
      name: scenario.repo || 'repo.v2',
      owner: { login: 'owned' },
      url: `https://${scenario.host || 'github.com'}/owned/${scenario.repo || 'repo.v2'}`,
    })
  );
else if (args[0] === 'issue')
  process.stdout.write(
    JSON.stringify(
      args.includes('open')
        ? [
            {
              number: 12,
              title: 'Owned issue',
              state: 'OPEN',
              body: 'Fixture',
              labels: [],
              author: { login: 'fixture' },
              assignees: [],
            },
          ]
        : []
    )
  );
else if (args[0] === 'pr')
  process.stdout.write(
    JSON.stringify(
      args.includes('open')
        ? [
            {
              number: 24,
              title: 'Owned PR',
              state: 'OPEN',
              body: '',
              isDraft: false,
              labels: [],
              author: { login: 'fixture' },
            },
          ]
        : []
    )
  );
else if (args[0] === 'api') {
  const request = input ? JSON.parse(input) : undefined;
  const query = request?.query || '';
  const variables = request?.variables || {};
  let resolved = false;
  try {
    resolved = JSON.parse(readFileSync(path.join(root, 'thread-state.json'), 'utf8')).isResolved;
  } catch {
    /* initial state */
  }
  if (args[1] !== 'graphql') {
    if (scenario.mode === 'review-rest-failed') {
      process.stderr.write('private-provider-credential');
      process.exitCode = 1;
    } else {
      const endpoint = new URL('https://fixture/' + args[1]);
      const row = {
        id: 10,
        user: null,
        performed_via_github_app: { slug: 'owned-bot' },
        body: 'Bot comment',
        created_at: '2026-10-01T00:00:00Z',
      };
      let rows = [row];
      if (endpoint.pathname.includes('/pulls/') && endpoint.pathname.endsWith('/comments'))
        rows = [
          {
            ...row,
            id: 500,
            body: 'Inline',
            path: 'src/owned.ts',
            line: 7,
            position: 1,
            diff_hunk: '@@ owned',
            side: 'RIGHT',
            commit_id: 'owned-commit',
          },
        ];
      if (endpoint.pathname.endsWith('/reviews'))
        rows = [
          {
            ...row,
            id: 30,
            body: 'Review body',
            submitted_at: '2026-10-02T00:00:00Z',
            state: 'COMMENTED',
          },
        ];
      if (scenario.mode === 'review-pages' && endpoint.pathname.includes('/issues/'))
        rows =
          endpoint.searchParams.get('page') === '1'
            ? Array.from({ length: 100 }, (_, index) => ({ ...row, id: 1000 + index }))
            : [{ ...row, id: 2000 }];
      process.stdout.write(JSON.stringify(rows));
    }
  } else if (query.startsWith('query GetIssueComments')) {
    process.stdout.write(
      JSON.stringify({
        data: {
          repository: {
            issueOrPullRequest: {
              comments: {
                totalCount: 2,
                pageInfo: {
                  hasNextPage: !variables.cursor,
                  endCursor: variables.cursor ? null : 'cursor_2',
                },
                nodes: [
                  {
                    id: variables.cursor ? 'second' : 'first',
                    author: null,
                    body: 'Issue comment',
                    createdAt: '2026-10-01T00:00:00Z',
                    updatedAt: '2026-10-01T00:00:00Z',
                  },
                ],
              },
            },
          },
        },
      })
    );
  } else if (query.startsWith('query GetPRReviewThreads')) {
    if (scenario.mode === 'review-metadata-failed') {
      process.stderr.write('private-provider-credential');
      process.exitCode = 1;
    } else
      process.stdout.write(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: 'PRRT_owned',
                      isResolved: resolved,
                      isOutdated: false,
                      comments: { nodes: [{ databaseId: 500 }] },
                    },
                  ],
                },
              },
            },
          },
        })
      );
  } else if (query.startsWith('query ReviewThreadTarget')) {
    process.stdout.write(
      JSON.stringify({
        data: {
          repository: { id: 'R_owned', nameWithOwner: 'owned/repo.v2' },
          node: {
            __typename: 'PullRequestReviewThread',
            id: variables.threadId,
            repository: {
              id: scenario.mode === 'review-foreign' ? 'R_other' : 'R_owned',
              nameWithOwner: scenario.mode === 'review-foreign' ? 'other/repo' : 'owned/repo.v2',
            },
            isResolved: resolved,
            viewerCanResolve: scenario.mode !== 'review-denied',
            viewerCanUnresolve: scenario.mode !== 'review-denied',
          },
        },
      })
    );
  } else if (query.startsWith('mutation ')) {
    const isResolved = !query.includes('unresolveReviewThread');
    writeFileSync(path.join(root, 'thread-state.json'), JSON.stringify({ isResolved }));
    if (scenario.mode === 'review-lost') {
      process.stderr.write('private-provider-credential');
      process.exitCode = 1;
    } else if (scenario.mode === 'review-malformed') process.stdout.write('{');
    else
      process.stdout.write(
        JSON.stringify({
          data: {
            [isResolved ? 'resolveReviewThread' : 'unresolveReviewThread']: {
              thread: { id: variables.threadId, isResolved },
            },
          },
        })
      );
  } else if (scenario.mode === 'links-failed') {
    process.stderr.write('private-provider-credential');
    process.exitCode = 1;
  } else {
    const { variables } = JSON.parse(input);
    const repository = {};
    for (const name of Object.keys(variables).filter((key) => key.startsWith('number')))
      repository['issue' + name.slice(6)] = {
        timelineItems: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              source: {
                number: 24,
                title: 'Linked PR',
                state: 'OPEN',
                url: 'https://github.com/owned/repo.v2/pull/24',
              },
            },
          ],
        },
      };
    process.stdout.write(JSON.stringify({ data: { repository } }));
  }
} else {
  process.exitCode = 2;
}
