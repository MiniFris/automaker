import { expect, test } from '@playwright/test';
import { lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { authenticateForTests } from '../utils';

test('previews, cancels and confirms the actual owned host Cursor permissions file', async ({
  page,
}) => {
  await authenticateForTests(page);
  await page.goto('/settings?view=cursor-provider');
  await page.getByRole('button', { name: /CLI Permissions/ }).click();
  const apply = page.getByRole('button', { name: 'Apply Globally', exact: true }).first();
  await expect(apply).toBeEnabled();
  const preview = page.waitForResponse((response) =>
    response.url().includes('/api/setup/cursor-permissions/target?scope=global')
  );
  await apply.click();
  const target = (await (await preview).json()).target;
  const root = path.resolve(target.workingDirectory);
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^automaker-nest-e2e-[a-zA-Z0-9]+$/);
  expect((await lstat(root)).isSymbolicLink()).toBe(false);
  expect(target.configPath).toBe(path.join(root, 'host-cursor-profile', 'cli-config.json'));
  await expect(lstat(target.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  const dialog = page.getByRole('dialog', { name: 'Apply Cursor permission profile?' });
  await expect(dialog.getByTestId('cursor-permissions-target')).toContainText(target.configPath);
  await expect(dialog.getByTestId('cursor-permissions-target')).toContainText(target.instanceId);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(lstat(target.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  let created: unknown;
  try {
    await apply.click();
    const complete = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/setup/cursor-permissions/profile') &&
        response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: 'Confirm permission change' }).click();
    const response = await complete;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      confirmed: true,
      target,
      profileId: 'strict',
    });
    expect(await response.json()).toMatchObject({ success: true, target, profileId: 'strict' });
    created = JSON.parse(await readFile(target.configPath, 'utf8'));
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /CLI Permissions/ }).click();
    await expect(page.getByText(target.configPath, { exact: true })).toBeVisible();
    expect(JSON.parse(await readFile(target.configPath, 'utf8'))).toEqual(created);
  } finally {
    // Restore only this fixture's new config, never a user profile or arbitrary path.
    const stat = await lstat(target.configPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (stat) {
      expect(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1).toBe(true);
      const content = JSON.parse(await readFile(target.configPath, 'utf8'));
      expect(Object.keys(content).sort()).toEqual(['permissions', 'version']);
      if (created) expect(content).toEqual(created);
      await unlink(target.configPath);
    }
  }
});
