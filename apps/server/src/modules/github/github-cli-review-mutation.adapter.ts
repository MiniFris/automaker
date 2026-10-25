import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
  UnavailableDomainError,
  UnknownOutcomeDomainError,
} from '../../core/errors/domain-errors.js';
import { GithubCommandRuntime, GithubCommandError } from './github-command.runtime.js';
import { GithubResponseError, githubRepository } from './github-cli-read.adapter.js';
import { GithubReviewMutationPort } from './github-review.port.js';
import type { GithubRemote } from './github-read.port.js';
import { githubHost } from './github-target.js';
import { githubJson, githubDecode, githubGraphqlData } from './github-json.js';

const targetQuery = `query ReviewThreadTarget($owner: String!, $repo: String!, $threadId: ID!) {
  repository(owner: $owner, name: $repo) { id nameWithOwner }
  node(id: $threadId) { __typename ... on PullRequestReviewThread {
    id isResolved viewerCanResolve viewerCanUnresolve repository { id nameWithOwner }
  } }
}`;
const repositorySchema = z.object({ id: z.string().min(1), nameWithOwner: z.string().min(1) });

/** Write-only application port: preflight and a single dispatch, never automatic replay. */
@Injectable()
export class GithubCliReviewMutationAdapter extends GithubReviewMutationPort {
  constructor(@Inject(GithubCommandRuntime) private readonly runtime: GithubCommandRuntime) {
    super();
  }
  async resolveThread(
    projectPath: string,
    remote: GithubRemote,
    threadId: string,
    resolve: boolean,
    signal: AbortSignal
  ) {
    const binding = githubRepository(remote.owner, remote.repo),
      hostname = githubHost(remote);
    const args = ['api', 'graphql', '--hostname', hostname, '--input', '-'];
    signal.throwIfAborted();
    const targetData = githubGraphqlData(
      githubJson(
        (
          await this.runtime.run({
            program: 'gh',
            args,
            cwd: projectPath,
            signal,
            input: JSON.stringify({ query: targetQuery, variables: { ...binding, threadId } }),
          })
        ).stdout
      )
    );
    const target = githubDecode(
      z.object({
        repository: repositorySchema.nullable(),
        node: z
          .object({
            __typename: z.string(),
            id: z.string().optional(),
            repository: repositorySchema.optional(),
            isResolved: z.boolean().optional(),
            viewerCanResolve: z.boolean().optional(),
            viewerCanUnresolve: z.boolean().optional(),
          })
          .nullable(),
      }),
      targetData
    );
    if (!target.repository || !target.node || target.node.__typename !== 'PullRequestReviewThread')
      throw new NotFoundDomainError('GitHub review thread or repository not found.');
    if (
      target.repository.nameWithOwner.toLowerCase() !==
      `${binding.owner}/${binding.repo}`.toLowerCase()
    )
      throw new ConflictDomainError('GitHub repository target changed. Inspect it again.');
    if (target.node.repository?.id !== target.repository.id || target.node.id !== threadId)
      throw new ForbiddenDomainError('Review thread does not belong to the project repository.');
    if (typeof target.node.isResolved !== 'boolean') throw new GithubResponseError();
    if (target.node.isResolved === resolve) return { isResolved: resolve };
    const permitted = resolve ? target.node.viewerCanResolve : target.node.viewerCanUnresolve;
    if (permitted !== true)
      throw new ForbiddenDomainError('Review thread mutation is not permitted.');
    signal.throwIfAborted();
    const name = resolve ? 'resolveReviewThread' : 'unresolveReviewThread';
    const query = `mutation ${resolve ? 'ResolveThread' : 'UnresolveThread'}($threadId: ID!) { ${name}(input: { threadId: $threadId }) { thread { id isResolved } } }`;
    // A synchronous admission refusal proves no dispatch. After a returned promise,
    // only an explicit spawn failure proves the CLI never started.
    const dispatched = this.runtime.run({
      program: 'gh',
      args,
      cwd: projectPath,
      signal,
      input: JSON.stringify({ query, variables: { threadId } }),
    });
    try {
      const data = githubGraphqlData(githubJson((await dispatched).stdout));
      const result = githubDecode(
        z.object({ thread: z.object({ id: z.string(), isResolved: z.boolean() }) }),
        data[name]
      );
      if (result.thread.id !== threadId || result.thread.isResolved !== resolve)
        throw new GithubResponseError();
      return { isResolved: result.thread.isResolved };
    } catch (error) {
      if (error instanceof GithubCommandError && error.kind === 'spawn')
        throw new UnavailableDomainError('GitHub mutation CLI could not start.');
      throw new UnknownOutcomeDomainError(
        'GitHub thread mutation outcome is unconfirmed. No command was replayed.'
      );
    }
  }
}
