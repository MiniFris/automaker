import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
import * as git from '@automaker/contracts/domains/git';
import * as worktree from '@automaker/contracts/domains/worktree';
let client: HttpApiClient;
const request = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', request);
  client = new HttpApiClient();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
it('carries an inspected target into mutations without changing caller-owned options', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', targetId: 'a'.repeat(64) },
    })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValueOnce(response({ success: true, result: { committed: true } }));
  await client.worktree.commit('/project', 'Literal $(command)', ['source.txt']);
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
    worktreePath: '/project',
    message: 'Literal $(command)',
    environmentTargetId: 'a'.repeat(64),
  });
});
it('remembers per-worktree identities from list responses, without sending one project token to another', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      worktrees: [
        {
          path: '/project/.worktrees/task',
          executionEnvironment: { path: '/project/.worktrees/task', targetId: 'b'.repeat(64) },
        },
      ],
    })
  );
  await client.worktree.listAll('/project');
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.stageFiles('/project/.worktrees/task', ['file'], 'stage');
  await client.worktree.commit('/other', 'Other');
  expect(JSON.parse(request.mock.calls[1][1].body).environmentTargetId).toBe('b'.repeat(64));
  expect(JSON.parse(request.mock.calls[2][1].body)).not.toHaveProperty('environmentTargetId');
});
it('does not treat an untrusted-shaped/empty target id as an inspected capability', async () => {
  request.mockResolvedValueOnce(
    response({ success: true, executionEnvironment: { path: '/project', targetId: 'invalid' } })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.commit('/project', 'x');
  expect(JSON.parse(request.mock.calls[1][1].body)).not.toHaveProperty('environmentTargetId');
});
it('clears the old remote scope only after observing a Local response', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', targetId: 'a'.repeat(64) },
    })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', type: 'local', targetId: '' },
    })
  );
  await client.git.getDiffs('/project');
  request.mockResolvedValue(response({ success: true }));
  await client.worktree.commit('/project', 'Local after inspection');
  expect(JSON.parse(request.mock.calls[2][1].body)).not.toHaveProperty('environmentTargetId');
});

it('keeps inspected IDs out of strict read and session requests', async () => {
  const calls = [
    [() => client.git.getDiffs('/project'), git.GitProjectSchema],
    [() => client.git.getFileDiff('/project', 'file.ts'), git.GitFileSchema],
    [() => client.git.getDetails('/project', 'file.ts'), git.GitDetailsSchema],
    [() => client.git.getEnhancedStatus('/project'), git.GitProjectSchema],
    [() => client.worktree.listAll('/project', true), worktree.WorktreeProjectSchema],
    [() => client.worktree.getInfo('/project', 'feature'), worktree.WorktreeFeatureSchema],
    [() => client.worktree.getStatus('/project', 'feature'), worktree.WorktreeFeatureSchema],
    [() => client.worktree.getDiffs('/project', 'feature'), worktree.WorktreeFeatureSchema],
    [
      () => client.worktree.getFileDiff('/project', 'feature', 'file.ts'),
      worktree.WorktreeFileSchema,
    ],
    [() => client.worktree.checkChanges('/project'), worktree.WorktreePathSchema],
    [() => client.worktree.listBranches('/project', true), worktree.WorktreeBranchesSchema],
    [() => client.worktree.listRemotes('/project'), worktree.WorktreePathSchema],
    [() => client.worktree.getCommitLog('/project', 10), worktree.WorktreeCommitLogSchema],
    [
      () => client.worktree.getBranchCommitLog('/project', 'main', 10),
      worktree.WorktreeBranchCommitLogSchema,
    ],
    [() => client.worktree.stashList('/project'), worktree.WorktreePathSchema],
    [() => client.worktree.getPRInfo('/project', 'main'), worktree.WorktreePrInfoSchema],
    [() => client.worktree.stopDevServer('/project', 'session'), worktree.DevSessionSchema],
    [() => client.worktree.initGit('/project'), worktree.WorktreeInitGitSchema],
    [() => client.executionEnvironments.inspectGit('/project'), git.GitProjectSchema],
  ] as const;
  for (const [call, schema] of calls) {
    request.mockResolvedValueOnce(
      response({
        success: true,
        executionEnvironment: { path: '/project', targetId: 'a'.repeat(64) },
      })
    );
    await client.executionEnvironments.inspectGit('/project');
    request.mockResolvedValueOnce(response({ success: true }));
    await call();
    const body = JSON.parse(request.mock.calls.at(-1)![1].body);
    expect(body).not.toHaveProperty('environmentTargetId');
    expect(schema.safeParse(body).success).toBe(true);
  }
});

it('retains the inspected target on every supported Git mutation contract', async () => {
  request.mockResolvedValueOnce(
    response({
      success: true,
      executionEnvironment: { path: '/project', targetId: 'a'.repeat(64) },
    })
  );
  await client.executionEnvironments.inspectGit('/project');
  request.mockResolvedValue(response({ success: true }));
  const calls = [
    [() => client.git.stageFiles('/project', ['file.ts'], 'stage'), git.GitStageFilesSchema],
    [
      () => client.worktree.stageFiles('/project', ['file.ts'], 'stage'),
      worktree.WorktreeStageFilesSchema,
    ],
    [() => client.worktree.commit('/project', 'Message'), worktree.WorktreeCommitSchema],
    [() => client.worktree.abortOperation('/project'), worktree.WorktreeMutationSchema],
    [() => client.worktree.continueOperation('/project'), worktree.WorktreeMutationSchema],
    [
      () => client.worktree.addRemote('/project', 'origin', 'https://example.com/repo.git'),
      worktree.WorktreeRemoteAddSchema,
    ],
    [
      () => client.worktree.setTracking('/project', 'origin', 'main'),
      worktree.WorktreeTrackingSchema,
    ],
    [() => client.worktree.stashPush('/project', 'Message'), worktree.WorktreeStashPushSchema],
    [() => client.worktree.stashApply('/project', 0), worktree.WorktreeStashApplySchema],
    [() => client.worktree.stashDrop('/project', 0), worktree.WorktreeStashDropSchema],
    [
      () => client.worktree.checkoutBranch('/project', 'feature'),
      worktree.WorktreeCheckoutBranchSchema,
    ],
    [() => client.worktree.switchBranch('/project', 'main'), worktree.WorktreeSwitchBranchSchema],
    [() => client.worktree.discardChanges('/project', ['file.ts']), worktree.WorktreeDiscardSchema],
    [() => client.worktree.pull('/project'), worktree.WorktreePullSchema],
    [() => client.worktree.push('/project'), worktree.WorktreePushSchema],
    [() => client.worktree.sync('/project'), worktree.WorktreeSyncSchema],
    [() => client.worktree.rebase('/project', 'main'), worktree.WorktreeRebaseSchema],
    [() => client.worktree.cherryPick('/project', ['abcd1234']), worktree.WorktreeCherryPickSchema],
    [
      () => client.worktree.mergeFeature('/project', 'feature', '/project', 'main'),
      worktree.WorktreeMergeSchema,
    ],
    [() => client.worktree.create('/project', 'feature'), worktree.WorktreeCreateSchema],
    [() => client.worktree.delete('/project', '/project'), worktree.WorktreeDeleteSchema],
    [
      () => client.worktree.runInitScript('/project', '/project', 'main'),
      worktree.WorktreeRunInitScriptSchema,
    ],
    [() => client.worktree.createPR('/project'), worktree.WorktreeCreatePrSchema],
    [() => client.worktree.updatePRNumber('/project', 1), worktree.WorktreeUpdatePrNumberSchema],
    [
      () => client.worktree.setInitScript('/project', 'echo test'),
      worktree.WorktreeInitScriptWriteSchema,
    ],
    [() => client.worktree.deleteInitScript('/project'), worktree.WorktreeInitScriptDeleteSchema],
  ] as const;
  for (const [call, schema] of calls) {
    await call();
    const body = JSON.parse(request.mock.calls.at(-1)![1].body);
    expect(body.environmentTargetId).toBe('a'.repeat(64));
    expect(schema.safeParse(body).success).toBe(true);
  }
});
