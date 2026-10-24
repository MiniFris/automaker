import { expect, test } from '@playwright/test';
import { lstat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authenticateForTests } from '../utils';

test('inspects, cancels and confirms app-scoped provider disconnect and restores state after reload', async ({
  page,
}) => {
  await authenticateForTests(page);
  await page.goto('/settings?view=cursor-provider');
  const disconnect = page.getByRole('button', { name: 'Disconnect from Automaker' });
  await expect(disconnect).toBeVisible();
  const mutations: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/setup/deauth-cursor'))
      mutations.push(request.postDataJSON());
  });
  const preview = page.waitForResponse((response) =>
    response.url().includes('/api/setup/connection-target?provider=cursor')
  );
  await disconnect.click();
  const target = (await (await preview).json()).target;
  // The E2E server's application profile is an owned temporary directory, not the repository.
  const ownedRoot = path.resolve(target.workingDirectory);
  expect(path.dirname(ownedRoot)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(ownedRoot)).toMatch(/^automaker-nest-e2e-[a-zA-Z0-9]+$/);
  expect((await lstat(ownedRoot)).isSymbolicLink()).toBe(false);
  expect(target.kind).toBe('host-application');
  expect(target.provider).toBe('cursor');
  let attempted = false;
  try {
    const dialog = page.getByRole('dialog', { name: 'Disconnect provider?' });
    await expect(dialog.getByTestId('provider-disconnect-target')).toContainText(
      target.workingDirectory
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
    expect(mutations).toHaveLength(0);
    await expect(disconnect).toBeVisible();
    await disconnect.click();
    await expect(dialog.getByTestId('provider-disconnect-target')).toContainText(ownedRoot);
    await expect(dialog.getByTestId('provider-disconnect-target')).toContainText(target.instanceId);
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/setup/deauth-cursor') &&
        response.request().method() === 'POST'
    );
    attempted = true;
    await dialog.getByRole('button', { name: /^Disconnect/ }).click();
    const response = await completed;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, connected: false, target });
    expect(mutations).toEqual([{ confirmed: true, target }]);
    await expect(disconnect).not.toBeVisible();
    await expect(page.getByText('Not Authenticated', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Not Authenticated', { exact: true })).toBeVisible();
    await expect(disconnect).not.toBeVisible();
  } finally {
    if (attempted) {
      // Restore only this test's empty marker; never call a real CLI auth/logout.
      const parent = await lstat(path.join(ownedRoot, '.automaker')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        }
      );
      if (parent) {
        expect(parent.isDirectory() && !parent.isSymbolicLink()).toBe(true);
        const marker = path.join(ownedRoot, '.automaker', '.cursor-disconnected');
        const stat = await lstat(marker).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (stat) {
          expect(stat.isFile() && !stat.isSymbolicLink() && stat.size === 0).toBe(true);
          await unlink(marker);
        }
      }
    }
  }
});
