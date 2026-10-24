import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { NotFoundDomainError } from '../../core/errors/domain-errors.js';
import { GithubCommandRuntime, GithubCommandError } from './github-command.runtime.js';
import { GithubResponseError, githubRepository } from './github-cli-read.adapter.js';
import { GithubCommentsReadPort, type PRReviewComment } from './github-review.port.js';
import type { GithubRemote } from './github-read.port.js';
import { githubJson, githubDecode, githubGraphqlData } from './github-json.js';
import { githubHost } from './github-target.js';

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().max(2048).nullable() });
const stamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const restRow = z.object({
  id: z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)]),
  user: z
    .object({ login: z.string(), avatar_url: z.string().nullish(), type: z.string().optional() })
    .nullable(),
  body: z.string(),
  created_at: stamp.optional(),
  updated_at: stamp.optional(),
  submitted_at: stamp.nullish(),
  performed_via_github_app: z.object({ slug: z.string() }).nullish(),
  path: z.string().optional(),
  line: z.number().int().nullish(),
  original_line: z.number().int().nullish(),
  position: z.number().int().nullish(),
  diff_hunk: z.string().optional(),
  side: z.string().optional(),
  commit_id: z.string().optional(),
  state: z.string().optional(),
});
type RestRow = z.infer<typeof restRow>;
interface Budget {
  bytes: number;
}
interface ThreadInfo {
  threadId: string;
  isResolved: boolean;
  isOutdated?: boolean;
}

const issueQuery = `query GetIssueComments($owner: String!, $repo: String!, $issueNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) { issueOrPullRequest(number: $issueNumber) {
    ... on Issue { comments(first: 50, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id author { login avatarUrl } body createdAt updatedAt } } }
    ... on PullRequest { comments(first: 50, after: $cursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id author { login avatarUrl } body createdAt updatedAt } } }
  } }
}`;
const threadQuery = `query GetPRReviewThreads($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $prNumber) { reviewThreads(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor } nodes { id isResolved isOutdated comments(first: 100) { nodes { databaseId } } }
  } } }
}`;

@Injectable()
export class GithubCliCommentsAdapter extends GithubCommentsReadPort {
  constructor(@Inject(GithubCommandRuntime) private readonly runtime: GithubCommandRuntime) {
    super();
  }
  private async json(
    projectPath: string,
    args: string[],
    signal: AbortSignal,
    budget: Budget,
    input?: object
  ) {
    signal.throwIfAborted();
    const result = await this.runtime.run({
      program: 'gh',
      cwd: projectPath,
      args,
      input: input && JSON.stringify(input),
      signal,
    });
    budget.bytes += Buffer.byteLength(result.stdout);
    if (budget.bytes > 10 * 1024 * 1024) throw new GithubCommandError('limit');
    return githubJson(result.stdout);
  }

  async issueComments(
    projectPath: string,
    remote: GithubRemote,
    issueNumber: number,
    cursor: string | undefined,
    signal: AbortSignal
  ) {
    const binding = githubRepository(remote.owner, remote.repo);
    const data = githubGraphqlData(
      await this.json(
        projectPath,
        ['api', 'graphql', '--hostname', githubHost(remote), '--input', '-'],
        signal,
        { bytes: 0 },
        { query: issueQuery, variables: { ...binding, issueNumber, cursor: cursor || null } }
      )
    );
    const comment = z.object({
      id: z.string().min(1),
      author: z.object({ login: z.string(), avatarUrl: z.string().optional() }).nullable(),
      body: z.string(),
      createdAt: stamp,
      updatedAt: stamp.optional(),
    });
    const decoded = githubDecode(
      z.object({
        repository: z
          .object({
            issueOrPullRequest: z
              .object({
                comments: z.object({
                  totalCount: z.number().int().nonnegative(),
                  pageInfo,
                  nodes: z.array(comment.nullable()).max(50),
                }),
              })
              .nullable(),
          })
          .nullable(),
      }),
      data
    );
    const connection = decoded.repository?.issueOrPullRequest?.comments;
    if (!connection) throw new NotFoundDomainError('Issue or pull request not found.');
    if (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor)
      throw new GithubResponseError();
    return {
      comments: connection.nodes
        .filter((node) => node !== null)
        .map((node) => ({ ...node, author: node.author || { login: 'ghost' } })),
      totalCount: connection.totalCount,
      hasNextPage: connection.pageInfo.hasNextPage,
      endCursor: connection.pageInfo.endCursor || undefined,
    };
  }

  private async rest(
    projectPath: string,
    endpoint: string,
    host: string,
    signal: AbortSignal,
    budget: Budget
  ): Promise<RestRow[]> {
    const rows: RestRow[] = [],
      seen = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      const response = githubDecode(
        z.array(restRow).max(100),
        await this.json(
          projectPath,
          ['api', `${endpoint}?per_page=100&page=${page}`, '--hostname', host, '--method', 'GET'],
          signal,
          budget
        )
      );
      let added = 0;
      for (const row of response)
        if (!seen.has(String(row.id))) {
          seen.add(String(row.id));
          rows.push(row);
          added++;
        }
      if (response.length < 100) return rows;
      if (!added) throw new GithubResponseError();
    }
    throw new GithubResponseError(); // Never claim a truncated list is complete.
  }

  private async threads(
    projectPath: string,
    binding: { owner: string; repo: string },
    host: string,
    prNumber: number,
    signal: AbortSignal,
    budget: Budget
  ): Promise<Map<string, ThreadInfo>> {
    const known = new Map<string, ThreadInfo>(),
      cursors = new Set<string>();
    let cursor: string | null = null;
    const thread = z.object({
      id: z.string().min(1).max(512),
      isResolved: z.boolean(),
      isOutdated: z.boolean().optional(),
      comments: z.object({
        nodes: z
          .array(z.object({ databaseId: z.number().int().positive().safe().nullable() }).nullable())
          .max(100),
      }),
    });
    for (let page = 0; page < 20; page++) {
      const data = githubGraphqlData(
        await this.json(
          projectPath,
          ['api', 'graphql', '--hostname', host, '--input', '-'],
          signal,
          budget,
          { query: threadQuery, variables: { ...binding, prNumber, cursor } }
        )
      );
      const response = githubDecode(
        z.object({
          repository: z
            .object({
              pullRequest: z
                .object({
                  reviewThreads: z.object({ pageInfo, nodes: z.array(thread.nullable()).max(100) }),
                })
                .nullable(),
            })
            .nullable(),
        }),
        data
      );
      const connection = response.repository?.pullRequest?.reviewThreads;
      if (!connection) throw new GithubResponseError();
      for (const value of connection.nodes)
        if (value)
          for (const comment of value.comments.nodes)
            if (comment?.databaseId) {
              const key = String(comment.databaseId),
                existing = known.get(key);
              if (
                existing &&
                (existing.threadId !== value.id || existing.isResolved !== value.isResolved)
              )
                throw new GithubResponseError();
              known.set(key, {
                threadId: value.id,
                isResolved: value.isResolved,
                isOutdated: value.isOutdated,
              });
            }
      if (!connection.pageInfo.hasNextPage) return known;
      const next = connection.pageInfo.endCursor;
      if (!next || cursors.has(next)) throw new GithubResponseError();
      cursors.add(next);
      cursor = next;
    }
    throw new GithubResponseError();
  }

  async reviewComments(
    projectPath: string,
    remote: GithubRemote,
    prNumber: number,
    signal: AbortSignal
  ): Promise<PRReviewComment[]> {
    const binding = githubRepository(remote.owner, remote.repo),
      budget = { bytes: 0 },
      prefix = `repos/${binding.owner}/${binding.repo}`;
    // Mandatory catalogs are not silently replaced with empty/partial successes.
    const host = githubHost(remote);
    const regular = await this.rest(
      projectPath,
      `${prefix}/issues/${prNumber}/comments`,
      host,
      signal,
      budget
    );
    const inline = await this.rest(
      projectPath,
      `${prefix}/pulls/${prNumber}/comments`,
      host,
      signal,
      budget
    );
    const reviews = await this.rest(
      projectPath,
      `${prefix}/pulls/${prNumber}/reviews`,
      host,
      signal,
      budget
    );
    let known = new Map<string, ThreadInfo>();
    try {
      known = await this.threads(projectPath, binding, host, prNumber, signal, budget);
    } catch (error) {
      if (
        !(
          error instanceof GithubResponseError ||
          (error instanceof GithubCommandError && error.kind === 'exit' && !error.rateLimited)
        )
      )
        throw error;
    }
    const base = (row: RestRow, review: boolean): PRReviewComment => {
      const createdAt = review ? row.submitted_at : row.created_at;
      if (!createdAt) throw new GithubResponseError();
      return {
        id: review ? `review-${row.id}` : String(row.id),
        author: row.user?.login || row.performed_via_github_app?.slug || 'unknown',
        avatarUrl: row.user?.avatar_url || undefined,
        body: row.body,
        createdAt,
        updatedAt: row.updated_at,
        isReviewComment: false,
        isOutdated: false,
        isResolved: false,
        isBot: row.user?.type === 'Bot' || !!row.performed_via_github_app,
      };
    };
    const comments = [
      ...regular.map((row) => base(row, false)),
      ...inline.map((row) => {
        const metadata = known.get(String(row.id));
        return {
          ...base(row, false),
          isReviewComment: true,
          isResolved: metadata?.isResolved,
          threadId: metadata?.threadId,
          isOutdated:
            metadata?.isOutdated ??
            (row.position === null ? true : row.position !== undefined ? false : undefined),
          path: row.path,
          line: row.line ?? row.original_line ?? undefined,
          diffHunk: row.diff_hunk,
          side: row.side,
          commitId: row.commit_id,
        };
      }),
      ...reviews
        .filter((row) => row.body.trim() && row.state !== 'PENDING')
        .map((row) => base(row, true)),
    ];
    return comments.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}
