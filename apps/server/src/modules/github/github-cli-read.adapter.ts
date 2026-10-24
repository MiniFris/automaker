import { Inject, Injectable } from '@nestjs/common';
import { ConflictDomainError, UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { githubHost, githubUrlHost } from './github-target.js';
import { GithubCommandRuntime, GithubCommandError } from './github-command.runtime.js';
import { GithubReadPort, type GithubRemote } from './github-read.port.js';

export class GithubResponseError extends UnavailableDomainError {
  constructor() {
    super('GitHub returned an unavailable or invalid response.');
  }
}
const issueFields = 'number,title,state,author,createdAt,labels,url,body,assignees';
const prFields =
  'number,title,state,author,createdAt,labels,url,isDraft,headRefName,reviewDecision,mergeable,body';
const optionalFailure = (error: unknown) =>
  error instanceof GithubResponseError ||
  (error instanceof GithubCommandError &&
    !error.rateLimited &&
    ['spawn', 'exit'].includes(error.kind));

export function githubRepository(owner: unknown, repo: unknown): { owner: string; repo: string } {
  if (
    typeof owner !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(owner) ||
    typeof repo !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
    ['.', '..'].includes(repo)
  )
    throw new GithubResponseError();
  return { owner, repo };
}
export function publicRemoteUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    const scp = /^(?:([^@\s]+)@)?([^:\s/]+):([^\s]+)$/.exec(value);
    return scp ? `${scp[1] === 'git' ? 'git@' : ''}${scp[2]}:${scp[3].split(/[?#]/)[0]}` : null;
  }
}
function remoteRepository(value: string): { owner: string; repo: string } | null {
  try {
    let parts: string[];
    if (value.startsWith('git@github.com:'))
      parts = value.slice('git@github.com:'.length).split('/');
    else {
      const url = new URL(value);
      if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname !== 'github.com' || url.port)
        return null;
      parts = url.pathname.replace(/^\//, '').split('/');
    }
    if (parts.length !== 2) return null;
    return githubRepository(parts[0], parts[1].replace(/\.git$/, ''));
  } catch {
    return null;
  }
}
function parse(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new GithubResponseError();
  }
}
function records(stdout: string): Record<string, unknown>[] {
  const value = parse(stdout || '[]');
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item || typeof item !== 'object' || !Number.isSafeInteger(item.number) || item.number <= 0
    )
  )
    throw new GithubResponseError();
  return value;
}

/** Read-only discovery. No API accepts an arbitrary command or GraphQL query. */
@Injectable()
export class GithubCliReadAdapter extends GithubReadPort {
  constructor(@Inject(GithubCommandRuntime) private readonly runtime: GithubCommandRuntime) {
    super();
  }

  async remote(projectPath: string, signal: AbortSignal): Promise<GithubRemote> {
    let origin = '',
      absent = false;
    try {
      origin = (
        await this.runtime.run({
          program: 'git',
          args: ['remote', 'get-url', 'origin'],
          cwd: projectPath,
          signal,
        })
      ).stdout.trim();
    } catch (error) {
      if (!optionalFailure(error)) throw error;
      absent = error instanceof GithubCommandError && error.absent;
      if (absent) {
        try {
          absent = !(
            await this.runtime.run({ program: 'git', args: ['remote'], cwd: projectPath, signal })
          ).stdout.trim();
        } catch (observation) {
          if (
            !(
              observation instanceof GithubCommandError &&
              observation.kind === 'exit' &&
              observation.absent
            )
          )
            throw observation;
        }
      }
    }
    let resolved: { owner: string; repo: string } | null = null;
    let hostname: string | undefined;
    try {
      const value = parse(
        (
          await this.runtime.run({
            program: 'gh',
            args: ['repo', 'view', '--json', 'name,owner,url'],
            cwd: projectPath,
            signal,
          })
        ).stdout
      ) as { owner?: { login?: unknown }; name?: unknown; url?: unknown } | null;
      resolved = githubRepository(value?.owner?.login, value?.name);
      if (
        typeof value?.url !== 'string' ||
        !value.url.startsWith('https://') ||
        !githubUrlHost(value.url)
      ) {
        resolved = null;
        throw new GithubResponseError();
      }
      hostname = githubUrlHost(value.url);
      const metadataUrl = new URL(value.url);
      if (
        metadataUrl.protocol !== 'https:' ||
        metadataUrl.pathname.replace(/^\//, '').replace(/\/$/, '').toLowerCase() !==
          `${resolved.owner}/${resolved.repo}`.toLowerCase()
      ) {
        resolved = null;
        throw new GithubResponseError();
      }
      const originHost = githubUrlHost(origin);
      if (originHost && originHost !== hostname)
        throw new ConflictDomainError(
          'GitHub repository host changed. Inspect the project target.'
        );
    } catch (error) {
      if (!optionalFailure(error)) throw error;
      if (error instanceof GithubResponseError && !origin) throw error;
      if (!origin && !absent) throw new GithubResponseError();
    }
    resolved ??= remoteRepository(origin);
    if (!resolved) hostname = undefined;
    else hostname ??= githubUrlHost(origin);
    const status: GithubRemote = {
      hasGitHubRemote: !!resolved,
      remoteUrl: origin
        ? publicRemoteUrl(origin)
        : resolved
          ? `https://${hostname}/${resolved.owner}/${resolved.repo}`
          : null,
      owner: resolved?.owner ?? null,
      repo: resolved?.repo ?? null,
    };
    if (hostname)
      Object.defineProperty(status, 'hostname', {
        value: githubHost({ ...status, hostname }),
        enumerable: false,
      });
    return status;
  }

  private async list(
    projectPath: string,
    remote: GithubRemote,
    kind: 'issue' | 'pr',
    signal: AbortSignal
  ) {
    const binding = githubRepository(remote.owner, remote.repo);
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    let failure: unknown;
    const tasks = ['open', kind === 'issue' ? 'closed' : 'merged'].map(async (state, index) => {
      try {
        const response = await this.runtime.run({
          program: 'gh',
          args: [
            kind,
            'list',
            '-R',
            `${githubHost(remote)}/${binding.owner}/${binding.repo}`,
            '--state',
            state,
            '--json',
            kind === 'issue' ? issueFields : prFields,
            '--limit',
            index === 0 ? '100' : '50',
          ],
          cwd: projectPath,
          signal: combined,
        });
        const items = records(response.stdout);
        if (items.length > (index === 0 ? 100 : 50)) throw new GithubResponseError();
        return items;
      } catch (error) {
        failure ??= error;
        controller.abort();
        throw error;
      }
    });
    const results = await Promise.allSettled(tasks);
    const cleanup = results.find(
      (item) =>
        item.status === 'rejected' &&
        item.reason instanceof GithubCommandError &&
        item.reason.kind === 'cleanup'
    );
    if (cleanup?.status === 'rejected') throw cleanup.reason;
    if (failure) throw failure;
    return results.map((item) => (item.status === 'fulfilled' ? item.value : []));
  }

  async prs(projectPath: string, remote: GithubRemote, signal: AbortSignal) {
    const [openPRs, mergedPRs] = await this.list(projectPath, remote, 'pr', signal);
    return { openPRs, mergedPRs };
  }

  async issues(projectPath: string, remote: GithubRemote, signal: AbortSignal) {
    const [openIssues, closedIssues] = await this.list(projectPath, remote, 'issue', signal);
    const linked = new Map<number, Record<string, unknown>[]>();
    let complete = true;
    for (let offset = 0; offset < openIssues.length; offset += 20) {
      signal.throwIfAborted();
      const batch = openIssues.slice(offset, offset + 20);
      const variables: Record<string, unknown> = { owner: remote.owner, repo: remote.repo };
      const declarations = ['$owner: String!', '$repo: String!'];
      const selections = batch.map((issue, index) => {
        variables[`number${index}`] = issue.number;
        declarations.push(`$number${index}: Int!`);
        const timeline =
          'timelineItems(first: 10, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) { pageInfo { hasNextPage } nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number title state url } } } ... on ConnectedEvent { subject { ... on PullRequest { number title state url } } } } }';
        return `issue${index}: issueOrPullRequest(number: $number${index}) { ... on Issue { ${timeline} } ... on PullRequest { ${timeline} } }`;
      });
      const query = `query IssueLinks(${declarations.join(', ')}) { repository(owner: $owner, name: $repo) { ${selections.join(' ')} } }`;
      try {
        const response = parse(
          (
            await this.runtime.run({
              program: 'gh',
              args: ['api', 'graphql', '--hostname', githubHost(remote), '--input', '-'],
              cwd: projectPath,
              signal,
              input: JSON.stringify({ query, variables }),
            })
          ).stdout
        ) as {
          errors?: unknown[];
          data?: {
            repository?: Record<
              string,
              {
                timelineItems?: {
                  pageInfo?: { hasNextPage: boolean };
                  nodes?: Array<{
                    source?: Record<string, unknown>;
                    subject?: Record<string, unknown>;
                  }>;
                };
              }
            >;
          };
        };
        if (
          response &&
          Array.isArray(response.errors) &&
          response.errors.some(
            (error) =>
              error && typeof error === 'object' && 'type' in error && error.type === 'RATE_LIMITED'
          )
        )
          throw new GithubCommandError('exit', true);
        if (!response || response.errors?.length || !response.data?.repository)
          throw new GithubResponseError();
        for (const [index, issue] of batch.entries()) {
          const timeline = response.data.repository[`issue${index}`]?.timelineItems;
          const nodes = timeline?.nodes;
          if (!Array.isArray(nodes) || typeof timeline?.pageInfo?.hasNextPage !== 'boolean')
            throw new GithubResponseError();
          if (timeline.pageInfo.hasNextPage) {
            complete = false;
            continue;
          }
          const prs = new Map<number, Record<string, unknown>>();
          for (const node of nodes) {
            const pr = node?.source || node?.subject;
            if (pr && Number.isSafeInteger(pr.number) && Number(pr.number) > 0)
              prs.set(Number(pr.number), {
                number: pr.number,
                title: typeof pr.title === 'string' ? pr.title : '',
                state: typeof pr.state === 'string' ? pr.state.toLowerCase() : '',
                url: typeof pr.url === 'string' ? pr.url : '',
              });
          }
          linked.set(Number(issue.number), [...prs.values()]);
        }
      } catch (error) {
        if (!optionalFailure(error)) throw error;
        complete = false;
      }
    }
    return {
      openIssues: openIssues.map((issue) =>
        complete ? { ...issue, linkedPRs: linked.get(Number(issue.number)) ?? [] } : { ...issue }
      ),
      closedIssues,
    };
  }
}
