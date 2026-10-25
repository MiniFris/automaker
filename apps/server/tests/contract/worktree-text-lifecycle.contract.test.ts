import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNativeLocalWorktree } from '../helpers/native-local-worktree.js';
import { WorktreeTextService } from '../../src/modules/worktree/worktree-text.service.js';
import {
  CONTEXT_QUERY_PORT,
  type ContextQueryPort,
} from '../../src/modules/context/context-query.port.js';
import type { SimpleQueryResult } from '../../src/providers/simple-query-service.js';

it('drains an accepted text query on app.close without publishing late provider success', async () => {
  const fixture = await createNativeLocalWorktree();
  try {
    await fs.writeFile(path.join(fixture.project, 'source.txt'), 'changed\n');
    const port = fixture.runtime.app.get<ContextQueryPort>(CONTEXT_QUERY_PORT);
    const execute = vi.spyOn(port, 'execute').mockImplementation(
      (options) =>
        new Promise((resolve) => {
          options.abortController!.signal.addEventListener(
            'abort',
            () => resolve({ text: 'late success must not publish' }),
            { once: true }
          );
        })
    );
    const controller = new AbortController();
    const result = fixture.runtime.app
      .get(WorktreeTextService)
      .generateCommitMessage({ worktreePath: fixture.project }, controller)
      .then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error })
      );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await fixture.runtime.close();
    const outcome = await result;
    expect(outcome.value).toBeUndefined();
    expect(outcome.error).toBeInstanceOf(Error);
    expect(controller.signal.aborted).toBe(true);
  } finally {
    vi.restoreAllMocks();
    await fixture.close();
  }
});
it('retains an unconfirmed timed-out query and rejects replacement and later clean-close claims', async () => {
  const fixture = await createNativeLocalWorktree();
  let release = () => {};
  let expectedUncertainty = false;
  const held = new Promise<SimpleQueryResult>((resolve) => {
    release = () => resolve({ text: 'unconfirmed late success' });
  });
  try {
    await fs.writeFile(path.join(fixture.project, 'source.txt'), 'changed\n');
    await fixture.runtime.settings.updateGlobalSettings({
      providerModelTimeouts: { claude: { commitMessageTimeoutMs: 20 } },
    });
    const execute = vi
      .spyOn(fixture.runtime.app.get<ContextQueryPort>(CONTEXT_QUERY_PORT), 'execute')
      .mockReturnValue(held);
    const service = fixture.runtime.app.get(WorktreeTextService);
    const result = service
      .generateCommitMessage({ worktreePath: fixture.project }, new AbortController())
      .then(
        (value) => ({ value, error: undefined }),
        (error) => ({ value: undefined, error })
      );
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const outcome = await result;
    expectedUncertainty = true;
    expect(outcome.value).toBeUndefined();
    expect(outcome.error).toMatchObject({ errorCode: 'UNAVAILABLE', statusCode: 503 });
    await expect(
      service.generateCommitMessage({ worktreePath: fixture.project }, new AbortController())
    ).rejects.toMatchObject({ errorCode: 'UNAVAILABLE' });
    expect(execute).toHaveBeenCalledOnce();
    release();
    await held;
    const failure = await fixture.runtime.close().catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    await expect(fixture.runtime.close()).rejects.toBe(failure);
  } finally {
    release();
    await held;
    vi.restoreAllMocks();
    if (expectedUncertainty) await fixture.close().catch(() => {});
    else await fixture.close();
  }
});
