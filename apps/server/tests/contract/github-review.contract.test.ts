import { mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { githubReadFixture } from '../helpers/github-read-fixture.js';
import { GithubReadPort } from '../../src/modules/github/github-read.port.js';
import {
  GithubCommentsReadPort,
  GithubReviewMutationPort,
} from '../../src/modules/github/github-review.port.js';
import { GithubCliCommentsAdapter } from '../../src/modules/github/github-cli-comments.adapter.js';
import { GithubCliReviewMutationAdapter } from '../../src/modules/github/github-cli-review-mutation.adapter.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { parseLinuxProcessStat } from '../../src/core/platform/linux-process-group.js';
const execute = promisify(execFile);
async function start(hostname = 'github.com') {
  const fixture = await githubReadFixture(),
    project = path.join(fixture.root, 'owned project');
  await mkdir(project);
  await execute('git', ['-c', 'init.templateDir=', 'init', '--quiet', project]);
  await execute('git', [
    '-C',
    project,
    'remote',
    'add',
    'origin',
    `https://${hostname}/owned/repo.v2.git`,
  ]);
  await fixture.scenario('normal', { host: hostname });
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: fixture.root,
    dataDir: path.join(fixture.root, 'data'),
    providerRegistrations: [],
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      ...fixture.environment,
      GH_HOST: 'must-not-select-this.invalid',
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  const port = (runtime.app.getHttpServer().address() as { port: number }).port;
  return {
    ...runtime,
    fixture,
    project,
    post: async (route: string, fields: object = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/github/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
        body: JSON.stringify({ projectPath: project, ...fields }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
const mutations = (calls: Array<{ input: string }>) =>
  calls.filter((call) => call.input && JSON.parse(call.input).query.startsWith('mutation '));
async function killed(pid: number) {
  try {
    expect(['Z', 'X', 'x']).toContain(
      parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state
    );
  } catch (error) {
    expect(error).toMatchObject({ code: 'ENOENT' });
  }
}

describe.skipIf(process.platform !== 'linux')(
  'native GitHub reviews with owned offline CLI processes',
  () => {
    it('binds enterprise host internally, paginates catalogs, preserves review fields and confirms resolve/unresolve', async () => {
      const runtime = await start('enterprise.test');
      try {
        expect(runtime.app.get(GithubCommentsReadPort)).toBe(
          runtime.app.get(GithubCliCommentsAdapter)
        );
        expect(runtime.app.get(GithubReviewMutationPort)).toBe(
          runtime.app.get(GithubCliReviewMutationAdapter)
        );
        expect(runtime.app.get(GithubReadPort)).not.toHaveProperty('resolveThread');
        expect(runtime.app.get(GithubCommentsReadPort)).not.toHaveProperty('resolveThread');
        const remote = await runtime.post('check-remote');
        expect(remote.status).toBe(200);
        expect(remote.body).not.toHaveProperty('hostname');
        const first = await runtime.post('issue-comments', { issueNumber: 12 });
        expect(first).toMatchObject({
          status: 200,
          body: {
            success: true,
            totalCount: 2,
            hasNextPage: true,
            endCursor: 'cursor_2',
            comments: [{ id: 'first', author: { login: 'ghost' } }],
          },
        });
        expect(
          await runtime.post('issue-comments', { issueNumber: 12, cursor: 'cursor_2' })
        ).toMatchObject({
          status: 200,
          body: { hasNextPage: false, comments: [{ id: 'second' }] },
        });
        await runtime.fixture.scenario('review-pages', { host: 'enterprise.test' });
        const comments = await runtime.post('pr-review-comments', { prNumber: 24 });
        expect(comments.status).toBe(200);
        expect(comments.body.totalCount).toBe(103);
        expect(
          comments.body.comments.find((comment: { id: string }) => comment.id === '500')
        ).toMatchObject({
          isReviewComment: true,
          path: 'src/owned.ts',
          line: 7,
          author: 'owned-bot',
          isBot: true,
          threadId: 'PRRT_owned',
          isResolved: false,
          isOutdated: false,
          diffHunk: '@@ owned',
          side: 'RIGHT',
          commitId: 'owned-commit',
        });
        expect(
          await runtime.post('resolve-pr-comment', { threadId: 'PRRT_owned', resolve: true })
        ).toMatchObject({ status: 200, body: { success: true, isResolved: true } });
        expect(
          await runtime.post('resolve-pr-comment', { threadId: 'PRRT_owned', resolve: true })
        ).toMatchObject({ status: 200, body: { success: true, isResolved: true } });
        expect(
          await runtime.post('resolve-pr-comment', { threadId: 'PRRT_owned', resolve: false })
        ).toMatchObject({ status: 200, body: { success: true, isResolved: false } });
        const calls = await runtime.fixture.calls();
        expect(mutations(calls)).toHaveLength(2);
        expect(
          calls
            .filter((call) => call.args[0] === 'api')
            .every((call) => call.args[call.args.indexOf('--hostname') + 1] === 'enterprise.test')
        ).toBe(true);
        expect(calls.some((call) => call.args.includes('--paginate'))).toBe(false);
      } finally {
        try {
          await runtime.app.close();
        } finally {
          await runtime.fixture.cleanup();
        }
      }
    });

    it.each(['review-foreign', 'review-denied'])(
      'rejects an unauthorized target before mutation (%s)',
      async (mode) => {
        const runtime = await start();
        try {
          await runtime.fixture.scenario(mode);
          expect(
            await runtime.post('resolve-pr-comment', { threadId: 'PRRT_owned', resolve: true })
          ).toMatchObject({ status: 403, body: { success: false, errorCode: 'FORBIDDEN' } });
          expect(mutations(await runtime.fixture.calls())).toHaveLength(0);
        } finally {
          try {
            await runtime.app.close();
          } finally {
            await runtime.fixture.cleanup();
          }
        }
      }
    );

    it('does not fabricate unresolved/empty success on failed metadata/mandatory catalogs and rejects malformed input before CLI', async () => {
      const runtime = await start();
      try {
        for (const [route, fields] of [
          ['issue-comments', { issueNumber: -1 }],
          ['issue-comments', { issueNumber: 12, cursor: '" injected' }],
          ['resolve-pr-comment', { threadId: '" injected', resolve: true }],
        ] as const)
          expect(await runtime.post(route, fields)).toMatchObject({
            status: 400,
            body: { success: false },
          });
        await expect(runtime.fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
        await runtime.fixture.scenario('review-metadata-failed');
        const result = await runtime.post('pr-review-comments', { prNumber: 24 });
        expect(result.status).toBe(200);
        const inline = result.body.comments.find((comment: { id: string }) => comment.id === '500');
        expect(inline).not.toHaveProperty('isResolved');
        expect(inline).not.toHaveProperty('threadId');
        await runtime.fixture.scenario('review-rest-failed');
        expect(await runtime.post('pr-review-comments', { prNumber: 24 })).toMatchObject({
          status: 503,
          body: { success: false },
        });
      } finally {
        try {
          await runtime.app.close();
        } finally {
          await runtime.fixture.cleanup();
        }
      }
    });

    it.each(['review-lost', 'review-malformed'])(
      'retains unknown outcome after the fixture applied a mutation and never replays it (%s)',
      async (mode) => {
        const runtime = await start();
        const disposal = vi.spyOn(runtime.app.get(ProviderRegistry), 'onApplicationShutdown');
        try {
          await runtime.fixture.scenario(mode);
          const result = await runtime.post('resolve-pr-comment', {
            threadId: 'PRRT_owned',
            resolve: true,
          });
          expect(result).toMatchObject({
            status: 502,
            body: { success: false, errorCode: 'UNKNOWN_OUTCOME' },
          });
          expect(JSON.stringify(result)).not.toContain('private-provider-credential');
          expect(
            JSON.parse(await readFile(path.join(runtime.fixture.root, 'thread-state.json'), 'utf8'))
              .isResolved
          ).toBe(true);
          const count = (await runtime.fixture.calls()).length;
          expect(
            await runtime.post('resolve-pr-comment', { threadId: 'PRRT_owned', resolve: false })
          ).toMatchObject({ status: 502, body: { errorCode: 'UNKNOWN_OUTCOME' } });
          expect((await runtime.fixture.calls()).length).toBe(count);
          expect(mutations(await runtime.fixture.calls())).toHaveLength(1);
          await expect(runtime.app.close()).rejects.toMatchObject({
            code: 'APPLICATION_CLEANUP_FAILED',
          });
          expect(disposal).toHaveBeenCalledOnce();
        } finally {
          disposal.mockRestore();
          await runtime.app.close().catch(() => {});
          await runtime.fixture.cleanup();
        }
      }
    );

    it('drains an owned in-flight mutation and reports unknown outcome rather than successful shutdown/replay', async () => {
      const runtime = await start();
      await runtime.fixture.scenario('review-hold');
      const outcome = runtime
        .post('resolve-pr-comment', { threadId: 'PRRT_owned', resolve: true })
        .catch(() => ({ status: 0, body: { success: false } }));
      let group: number | undefined;
      try {
        await vi.waitFor(async () =>
          expect((await runtime.fixture.pids()).child).toBeGreaterThan(1)
        );
        const pids = await runtime.fixture.pids();
        expect(parseLinuxProcessStat(await readFile(`/proc/${pids.root}/stat`, 'utf8')).group).toBe(
          pids.root
        );
        group = pids.root;
        await expect(runtime.app.close()).rejects.toMatchObject({
          code: 'APPLICATION_CLEANUP_FAILED',
        });
        expect((await outcome).body.success).toBe(false);
        await killed(pids.root);
        await killed(pids.child);
        expect(mutations(await runtime.fixture.calls())).toHaveLength(1);
      } finally {
        if (group) {
          try {
            process.kill(-group, 'SIGKILL');
          } catch {
            /* fixture group already exited */
          }
        }
        await runtime.app.close().catch(() => {});
        await outcome;
        await runtime.fixture.cleanup();
      }
    });
  }
);
