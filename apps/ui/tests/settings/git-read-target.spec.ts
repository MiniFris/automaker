import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authenticateForTests,
  setupRealProject,
  createTempDirPath,
  cleanupTempDir,
} from '../utils';

const project = createTempDirPath('git-read-target');
test.beforeAll(() => {
  mkdirSync(join(project, '.automaker/features'), { recursive: true });
  writeFileSync(join(project, 'README.md'), 'Private Git target regression fixture\n');
  execFileSync('git', ['init', '-b', 'main', project]);
  execFileSync('git', ['-C', project, 'add', 'README.md']);
  execFileSync('git', [
    '-C',
    project,
    '-c',
    'user.name=E2E',
    '-c',
    'user.email=e2e@example.test',
    'commit',
    '-m',
    'Fixture',
  ]);
});
test.afterAll(() => cleanupTempDir(project));

test('native Git reads work repeatedly after the browser caches an inspected target', async ({
  page,
}) => {
  await setupRealProject(page, project, 'Git read target', { setAsCurrent: true });
  await page.route('**/api/settings/global', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, settings: { ...body.settings, setupComplete: true, isFirstRun: false } },
    });
  });
  expect(await authenticateForTests(page)).toBe(true);
  await page.goto('/board');
  await expect(page.getByTestId('board-view')).toBeVisible();
  // Seed an inspected target as on a bound project. Only inspection metadata is
  // changed; every Git/worktree read goes through the real native backend.
  await page.route('**/api/git/environment', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    expect(response.status()).toBe(200);
    await route.fulfill({
      response,
      json: {
        ...body,
        executionEnvironment: { ...body.executionEnvironment, targetId: 'a'.repeat(64) },
      },
    });
  });
  const reads: Array<{ path: string; body: object; status: number }> = [];
  page.on('response', (response) => {
    const request = response.request();
    if (
      request.method() === 'POST' &&
      /\/api\/(git|worktree)\//.test(request.url()) &&
      !request.url().endsWith('/environment')
    ) {
      reads.push({
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
        status: response.status(),
      });
    }
  });
  const results = await page.evaluate(async (projectPath) => {
    const modulePath = '/src/lib/http-api-client.ts';
    const { HttpApiClient } = await import(modulePath);
    const client = new HttpApiClient();
    const results = [];
    for (const call of [
      () => client.git.getDiffs(projectPath),
      () => client.git.getFileDiff(projectPath, 'README.md'),
      () => client.git.getDetails(projectPath),
      () => client.git.getEnhancedStatus(projectPath),
      () => client.worktree.listAll(projectPath),
      () => client.worktree.getDiffs(projectPath, 'main'),
      () => client.worktree.checkChanges(projectPath),
      () => client.worktree.listBranches(projectPath),
      () => client.worktree.listRemotes(projectPath),
      () => client.worktree.getCommitLog(projectPath),
      () => client.worktree.stashList(projectPath),
    ]) {
      const inspection = await client.executionEnvironments.inspectGit(projectPath);
      if (!inspection.success) throw new Error('Fixture inspection failed');
      results.push(await call());
    }
    return results;
  }, project);
  expect(results).toHaveLength(11);
  for (const result of results) expect(result.success).toBe(true);
  expect(reads.length).toBeGreaterThanOrEqual(11);
  expect(reads.some((read) => read.path === '/api/worktree/diffs')).toBe(true);
  for (const read of reads) {
    expect(read.status, read.path).toBe(200);
    expect(read.body, read.path).not.toHaveProperty('environmentTargetId');
  }
});
