import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createNativeWorktreeHttp } from '../../../helpers/native-worktree-http.js';

const exec = promisify(execFile);
it('creates the compatible initial commit before native worktree creation in an unborn repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-unborn-worktree-'));
  let runtime: Awaited<ReturnType<typeof createNativeWorktreeHttp>> | undefined;
  try {
    await exec('git', ['init', '--initial-branch=main'], { cwd: root });
    runtime = await createNativeWorktreeHttp({
      root,
      environment: { HOME: root, ALLOWED_ROOT_DIRECTORY: root },
    });
    const post = async (action: string, body: object) => {
      const response = await fetch(`${runtime!.url}/api/worktree/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': runtime!.apiKey },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const inspected = await post('environment', { projectPath: root });
    expect(inspected.status).toBe(200);
    const created = await post('create', {
      projectPath: root,
      branchName: 'feature/no-head',
      environmentTargetId: inspected.body.executionEnvironment.targetId,
    });
    expect(created.status).toBe(200);
    expect(created.body.success).toBe(true);
    expect(
      Number((await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: root })).stdout.trim())
    ).toBeGreaterThan(0);
    expect((await exec('git', ['log', '-1', '--pretty=%B'], { cwd: root })).stdout.trim()).toBe(
      'chore: automaker initial commit'
    );
    expect(
      (await exec('git', ['worktree', 'list', '--porcelain'], { cwd: root })).stdout
    ).toContain('branch refs/heads/feature/no-head');
  } finally {
    await runtime?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
