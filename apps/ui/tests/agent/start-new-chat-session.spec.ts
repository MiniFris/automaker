/**
 * Start New Chat Session E2E Test
 *
 * Happy path: Create a chat, stream a reply and reload persisted history.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  createTempDirPath,
  cleanupTempDir,
  setupRealProject,
  waitForNetworkIdle,
  navigateToAgent,
  clickNewSessionButton,
  waitForNewSession,
  countSessionItems,
  authenticateForTests,
} from '../utils';

const TEST_TEMP_DIR = createTempDirPath('agent-session-test');

test.describe('Agent Chat Session', () => {
  let projectPath: string;
  const projectName = `test-project-${Date.now()}`;

  test.beforeAll(async () => {
    if (!fs.existsSync(TEST_TEMP_DIR)) {
      fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }

    projectPath = path.join(TEST_TEMP_DIR, projectName);
    fs.mkdirSync(projectPath, { recursive: true });

    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({ name: projectName, version: '1.0.0' }, null, 2)
    );

    const automakerDir = path.join(projectPath, '.automaker');
    fs.mkdirSync(automakerDir, { recursive: true });
    fs.mkdirSync(path.join(automakerDir, 'features'), { recursive: true });
    fs.mkdirSync(path.join(automakerDir, 'context'), { recursive: true });
    fs.mkdirSync(path.join(automakerDir, 'sessions'), { recursive: true });

    fs.writeFileSync(
      path.join(automakerDir, 'categories.json'),
      JSON.stringify({ categories: [] }, null, 2)
    );

    fs.writeFileSync(
      path.join(automakerDir, 'app_spec.txt'),
      `# ${projectName}\n\nA test project for e2e testing.`
    );
  });

  test.afterAll(async () => {
    cleanupTempDir(TEST_TEMP_DIR);
  });

  test('lists, opens and stops a real held chat from Running Agents', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await setupRealProject(page, projectPath, projectName, { setAsCurrent: true });
    await authenticateForTests(page);
    await page.goto('/');
    await waitForNetworkIdle(page);
    await navigateToAgent(page);
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/sessions') && response.request().method() === 'POST'
    );
    await clickNewSessionButton(page);
    const { session } = await (await creation).json();
    try {
      await page.getByTestId('agent-input').fill('[test] hold Running Agents chat');
      await page.getByTestId('send-message').click();
      await expect(page.getByTestId('message-list')).toContainText(
        'Mock agent output for testing.'
      );
      await page.goto('/running-agents');
      await expect(page.getByRole('button', { name: 'Open Chat', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Open Chat', exact: true }).click();
      await expect(page.getByTestId('message-list')).toContainText(
        '[test] hold Running Agents chat'
      );
      await page.goto('/running-agents');
      const stop = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/agent/stop') && response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      expect((await stop).status()).toBe(200);
      await expect(page.getByRole('button', { name: 'Open Chat', exact: true })).toHaveCount(0);
    } finally {
      const response = await page.request.post('/api/agent/stop', {
        data: { sessionId: session.id },
      });
      expect(response.status()).toBe(200);
    }
  });

  test('should start a chat, receive streamed output and restore history after reload', async ({
    page,
  }) => {
    // Ensure desktop viewport so SessionManager sidebar is visible (hidden below 1024px)
    await page.setViewportSize({ width: 1280, height: 720 });

    await setupRealProject(page, projectPath, projectName, { setAsCurrent: true });

    await authenticateForTests(page);
    await page.goto('/');
    await waitForNetworkIdle(page);

    // Navigate to agent view
    await navigateToAgent(page);

    // Verify we're on the agent view
    await expect(page.locator('[data-testid="agent-view"]')).toBeVisible({ timeout: 10000 });

    // Click new session button
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/sessions') && response.request().method() === 'POST'
    );
    await clickNewSessionButton(page);
    const { session } = await (await creation).json();

    // Wait for new session to appear in the list
    await waitForNewSession(page, { timeout: 10000 });

    // Verify at least one session exists
    const sessionCount = await countSessionItems(page);
    expect(sessionCount).toBeGreaterThanOrEqual(1);

    // Verify the message list is visible (indicates the newly created session was selected)
    const messageList = page.locator('[data-testid="message-list"]');
    await expect(messageList).toBeVisible({ timeout: 10000 });

    // Verify the agent input is visible
    await expect(page.locator('[data-testid="agent-input"]')).toBeVisible();
    const prompt = 'Verify the Nest chat persistence boundary using the test provider.';
    await page.getByTestId('agent-input').fill(prompt);
    await page.getByTestId('send-message').click();
    await expect(messageList).toContainText(prompt);
    await expect(messageList).toContainText('Mock agent output for testing.');
    await expect(page.getByTestId('stop-agent')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('agent-view')).toBeVisible();
    await page.getByTestId(`session-item-${session.id}`).click();
    await expect(page.getByTestId('message-list')).toContainText(prompt);
    await expect(page.getByTestId('message-list')).toContainText('Mock agent output for testing.');
  });
});
