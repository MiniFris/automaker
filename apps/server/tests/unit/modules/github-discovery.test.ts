import { afterEach, expect, it, vi } from 'vitest';
import { GithubDiscoveryService } from '../../../src/modules/github/github-discovery.service.js';
import {
  GithubCliReadAdapter,
  publicRemoteUrl,
} from '../../../src/modules/github/github-cli-read.adapter.js';
import {
  GithubCommandError,
  githubCommandEnvironment,
} from '../../../src/modules/github/github-command.runtime.js';
const remote = {
  hasGitHubRemote: true,
  remoteUrl: null,
  owner: 'owned',
  repo: 'repo.v2',
  hostname: 'github.com',
};
afterEach(() => vi.useRealTimers());

it('preserves case-insensitive Windows PATH/auth while removing every GH_REPO case variant', () => {
  const input = { Path: 'C:\\Owned\\bin', gH_rEpO: 'wrong/repository', Gh_Token: 'fixture-secret' };
  const environment = githubCommandEnvironment(input, 'win32');
  expect(environment.PATH).toBe(input.Path);
  expect(environment.GH_TOKEN).toBe('fixture-secret');
  expect(environment).not.toHaveProperty('GH_REPO');
  expect(environment).not.toHaveProperty('Path');
  expect(input).toHaveProperty('gH_rEpO');
  expect(githubCommandEnvironment({}, 'win32')).not.toHaveProperty('PATH');
  expect(githubCommandEnvironment({}, 'linux').PATH?.split(':').slice(0, 2)).toEqual([
    '/usr/bin',
    '/bin',
  ]);
});

it('redacts credentials/query fragments and preserves dotted repository names with argv-only listing', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({
      stdout: 'https://secret:token@github.com/owned/repo.v2.git?token=secret',
    })
    .mockRejectedValueOnce(new GithubCommandError('exit'))
    .mockResolvedValue({ stdout: '[]' });
  const adapter = new GithubCliReadAdapter({ run });
  const status = await adapter.remote('/owned', new AbortController().signal);
  expect(status).toMatchObject({
    owner: 'owned',
    repo: 'repo.v2',
    remoteUrl: 'https://github.com/owned/repo.v2.git',
  });
  await adapter.prs('/owned path; literal', status, new AbortController().signal);
  expect(run.mock.calls[2][0]).toMatchObject({
    program: 'gh',
    args: [
      'pr',
      'list',
      '-R',
      'github.com/owned/repo.v2',
      '--state',
      'open',
      '--json',
      expect.any(String),
      '--limit',
      '100',
    ],
    cwd: '/owned path; literal',
  });
  expect(publicRemoteUrl('https://user:secret@example.com/repo?private=secret#token')).toBe(
    'https://example.com/repo'
  );
  expect(publicRemoteUrl('private-credential')).toBeNull();
  expect(publicRemoteUrl('private-user@example.com:owned/repo')).toBe('example.com:owned/repo');
});

it('uses GraphQL variables for repository and issue identifiers and deduplicates linked PRs', async () => {
  const run = vi.fn(async (command) =>
    command.args[0] === 'issue'
      ? { stdout: JSON.stringify(command.args.includes('open') ? [{ number: 12 }] : []) }
      : {
          stdout: JSON.stringify({
            data: {
              repository: {
                issue0: {
                  timelineItems: {
                    pageInfo: { hasNextPage: false },
                    nodes: [
                      { source: { number: 24, state: 'OPEN' } },
                      { subject: { number: 24, state: 'OPEN' } },
                    ],
                  },
                },
              },
            },
          }),
        }
  );
  const result = await new GithubCliReadAdapter({ run }).issues(
    '/owned',
    remote,
    new AbortController().signal
  );
  const input = JSON.parse(run.mock.calls[2][0].input);
  expect(input.variables).toEqual({ owner: 'owned', repo: 'repo.v2', number0: 12 });
  expect(input.query).not.toContain('repo.v2');
  expect(result.openIssues[0].linkedPRs).toEqual([
    { number: 24, title: '', state: 'open', url: '' },
  ]);
});

it.each(['', 'upstream\n'])(
  'does not infer absence of all remotes from a missing origin (%#)',
  async (remotes) => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new GithubCommandError('exit', false, true))
      .mockResolvedValueOnce({ stdout: remotes })
      .mockRejectedValueOnce(new GithubCommandError('spawn'));
    const request = new GithubCliReadAdapter({ run }).remote(
      '/owned',
      new AbortController().signal
    );
    if (remotes) await expect(request).rejects.toThrow('invalid response');
    else expect(await request).toMatchObject({ hasGitHubRemote: false });
    expect(run.mock.calls[1][0].args).toEqual(['remote']);
  }
);

it('does not let malformed/non-web CLI metadata escape as a raw URL error or redirect the verified origin', async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ stdout: 'https://github.com/owned/repo.v2.git' })
    .mockResolvedValueOnce({
      stdout: JSON.stringify({
        owner: { login: 'owned' },
        name: 'repo.v2',
        url: 'git@private-host:private-value',
      }),
    });
  const remote = await new GithubCliReadAdapter({ run }).remote(
    '/owned',
    new AbortController().signal
  );
  expect(remote).toMatchObject({
    hasGitHubRemote: true,
    owner: 'owned',
    repo: 'repo.v2',
    remoteUrl: 'https://github.com/owned/repo.v2.git',
  });
  expect(remote.hostname).toBe('github.com');
  expect(JSON.stringify(remote)).not.toContain('private-value');
});

it.each(['cancel', 'cleanup', 'deadline', 'limit'] as const)(
  'never swallows optional enrichment resource failure (%s)',
  async (kind) => {
    const run = vi.fn(async (command) => {
      if (command.args[0] === 'issue')
        return { stdout: JSON.stringify(command.args.includes('open') ? [{ number: 12 }] : []) };
      throw new GithubCommandError(kind);
    });
    await expect(
      new GithubCliReadAdapter({ run }).issues('/owned', remote, new AbortController().signal)
    ).rejects.toMatchObject({ kind });
  }
);

it.each([true, undefined])(
  'does not publish complete linked-PR metadata when pagination is incomplete/unknown (%s)',
  async (hasNextPage) => {
    const run = vi.fn(async (command) =>
      command.args[0] === 'issue'
        ? { stdout: JSON.stringify(command.args.includes('open') ? [{ number: 12 }] : []) }
        : {
            stdout: JSON.stringify({
              data: {
                repository: {
                  issue0: {
                    timelineItems: {
                      pageInfo: hasNextPage === undefined ? undefined : { hasNextPage },
                      nodes: [],
                    },
                  },
                },
              },
            }),
          }
    );
    const result = await new GithubCliReadAdapter({ run }).issues(
      '/owned',
      remote,
      new AbortController().signal
    );
    expect(result.openIssues[0]).not.toHaveProperty('linkedPRs');
  }
);

it('does not turn failed optional linked-PR discovery into confirmed absence', async () => {
  const run = vi.fn(async (command) => {
    if (command.args[0] === 'issue')
      return { stdout: JSON.stringify(command.args.includes('open') ? [{ number: 12 }] : []) };
    throw new GithubCommandError('exit');
  });
  const result = await new GithubCliReadAdapter({ run }).issues(
    '/owned',
    remote,
    new AbortController().signal
  );
  expect(result.openIssues[0]).not.toHaveProperty('linkedPRs');
});

it('cancels and awaits a failed list sibling rather than leaving it running after an error', async () => {
  let aborted = false;
  const run = vi.fn(async (command) => {
    if (command.args.includes('open')) {
      await Promise.resolve();
      throw new GithubCommandError('exit');
    }
    await new Promise<void>((resolve) =>
      command.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          resolve();
        },
        { once: true }
      )
    );
    throw new GithubCommandError('cancel');
  });
  await expect(
    new GithubCliReadAdapter({ run }).prs('/owned', remote, new AbortController().signal)
  ).rejects.toMatchObject({ kind: 'exit' });
  expect(aborted).toBe(true);
});

it('bounds discovery shutdown, prevents new admission and retains a failed close outcome', async () => {
  let resolve!: (value: typeof remote) => void;
  const reads = {
    remote: vi.fn(
      () =>
        new Promise<typeof remote>((done) => {
          resolve = done;
        })
    ),
    issues: vi.fn(),
    prs: vi.fn(),
  };
  const service = new GithubDiscoveryService(reads);
  const pending = service.remote('/owned');
  await Promise.resolve();
  vi.useFakeTimers();
  const closing = service.onModuleDestroy();
  const rejected = expect(closing).rejects.toMatchObject({
    code: 'GITHUB_DISCOVERY_CLEANUP_FAILED',
  });
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
  expect(service.onModuleDestroy()).toBe(closing);
  expect(() => service.remote('/owned')).toThrow('shutting down');
  const cancelled = expect(pending).rejects.toThrow('cancelled');
  resolve(remote);
  await cancelled;
});
