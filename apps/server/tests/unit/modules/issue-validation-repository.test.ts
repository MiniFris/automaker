import { afterEach, expect, it, vi } from 'vitest';
import { IssueValidationRepository } from '../../../src/modules/github/issue-validation.repository.js';
import type { ValidationFilesystem } from '../../../src/lib/validation-storage.js';

afterEach(() => vi.useRealTimers());
const contents = JSON.stringify({
  issueNumber: 12,
  issueTitle: 'Fixture',
  validatedAt: new Date().toISOString(),
  model: 'haiku',
  result: {},
});
function fixture(readFile: ValidationFilesystem['readFile']) {
  const filesystem = { readFile } as ValidationFilesystem;
  return new IssueValidationRepository(filesystem, () => '/canonical/project');
}

it('bounds accepted transactions and retains admission after a caller read failure', async () => {
  let release!: (value: string) => void;
  const held = new Promise<string>((done) => {
    release = done;
  });
  const read = vi.fn().mockReturnValue(held);
  const repository = fixture(read);
  const accepted = Array.from({ length: 256 }, () => repository.get('/project', 12));
  await expect(repository.get('/alias', 12)).rejects.toMatchObject({ statusCode: 503 });
  release(contents);
  await Promise.all(accepted);
  read.mockRejectedValueOnce(Object.assign(new Error('Owned EIO fixture'), { code: 'EIO' }));
  await expect(repository.get('/project', 12)).rejects.toMatchObject({ code: 'EIO' });
  expect((await repository.get('/alias', 12))?.validation.issueNumber).toBe(12);
  await repository.beforeApplicationShutdown();
});

it('bounds repository drain, rejects new work and retains a timeout after late IO completion', async () => {
  vi.useFakeTimers();
  let release!: (value: string) => void;
  const held = new Promise<string>((done) => {
    release = done;
  });
  const repository = fixture(vi.fn().mockReturnValue(held));
  const accepted = repository.get('/project', 12);
  const close = repository.beforeApplicationShutdown();
  const failure = expect(close).rejects.toMatchObject({
    code: 'ISSUE_VALIDATION_STORAGE_CLEANUP_FAILED',
  });
  await vi.advanceTimersByTimeAsync(5000);
  await failure;
  await expect(repository.get('/project', 12)).rejects.toMatchObject({ statusCode: 503 });
  release(contents);
  await accepted;
  expect(repository.beforeApplicationShutdown()).toBe(close);
  await expect(close).rejects.toMatchObject({ code: 'ISSUE_VALIDATION_STORAGE_CLEANUP_FAILED' });
});
