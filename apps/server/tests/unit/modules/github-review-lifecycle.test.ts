import { expect, it, vi } from 'vitest';
import { GithubReviewService } from '../../../src/modules/github/github-review.service.js';
import { UnknownOutcomeDomainError } from '../../../src/core/errors/domain-errors.js';
const remote = {
  hasGitHubRemote: true,
  remoteUrl: null,
  owner: 'owned',
  repo: 'repo.v2',
  hostname: 'github.com',
};
const input = { projectPath: '/project', threadId: 'PRRT_owned', resolve: true };
function fixture(write: ReturnType<typeof vi.fn>) {
  return new GithubReviewService(
    { remote: vi.fn().mockResolvedValue(remote) } as never,
    { issueComments: vi.fn(), reviewComments: vi.fn() },
    { resolveThread: write }
  );
}

it('serializes thread mutations across path aliases and releases only a confirmed operation', async () => {
  let release!: (value: { isResolved: boolean }) => void;
  const write = vi.fn(
    () =>
      new Promise<{ isResolved: boolean }>((done) => {
        release = done;
      })
  );
  const service = fixture(write);
  const pending = service.resolve(input);
  expect(() => service.resolve({ ...input, projectPath: '/alias', resolve: false })).toThrow(
    'still running'
  );
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  release({ isResolved: true });
  await pending;
  write.mockResolvedValue({ isResolved: false });
  await expect(service.resolve({ ...input, resolve: false })).resolves.toEqual({
    success: true,
    isResolved: false,
  });
  await service.onModuleDestroy();
});

it('retains unknown mutation identity, blocks replacements and fails checked lifecycle outcome', async () => {
  const write = vi.fn().mockRejectedValue(new UnknownOutcomeDomainError('private detail'));
  const service = fixture(write);
  await expect(service.resolve(input)).rejects.toMatchObject({ errorCode: 'UNKNOWN_OUTCOME' });
  expect(() => service.resolve(input)).toThrow('remains unconfirmed');
  expect(write).toHaveBeenCalledOnce();
  const closing = service.onModuleDestroy();
  await expect(closing).rejects.toMatchObject({ code: 'GITHUB_REVIEW_CLEANUP_FAILED' });
  expect(service.onModuleDestroy()).toBe(closing);
});
