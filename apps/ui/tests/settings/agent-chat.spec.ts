import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authenticateForTests,
  setupRealProject,
  createTempDirPath,
  cleanupTempDir,
} from '../utils';
import type { AgentConversationEntry } from '@automaker/types';

const project = createTempDirPath('agent-chat');
const featureId = 'chat-task';
const directory = join(project, '.automaker/features', featureId);
const record = (
  runId: string,
  sequence: number,
  kind: AgentConversationEntry['kind'],
  content = '',
  extra = {}
): AgentConversationEntry => ({
  id: `${runId}:${sequence}`,
  runId,
  sequence,
  timestamp: '2026-01-01T00:00:00Z',
  kind,
  content,
  ...extra,
});
test.beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'feature.json'),
    JSON.stringify({
      id: featureId,
      title: 'Agent chat fixture',
      description: 'Inspect the task history',
      category: 'test',
      status: 'verified',
    })
  );
  writeFileSync(join(directory, 'agent-output.md'), 'Old output must not duplicate chat messages');
  writeFileSync(
    join(directory, 'agent-conversation.jsonl'),
    [
      record('first', 0, 'session_start'),
      record('first', 1, 'assistant', 'Checking **requirements**.'),
      record('first', 2, 'thinking', 'Provider reasoning summary'),
      record('first', 3, 'tool_call', '', {
        toolName: 'Read',
        toolCallId: 'read',
        input: { file: 'README.md' },
      }),
      record('first', 4, 'tool_result', 'Read fixture result', {
        toolCallId: 'read',
        status: 'completed',
      }),
      record('first', 5, 'assistant', 'Task implementation finished.'),
      record('first', 6, 'session_end', '', { status: 'completed' }),
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  );
  const legacy = join(project, '.automaker/features/legacy-chat');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(
    join(legacy, 'feature.json'),
    JSON.stringify({
      id: 'legacy-chat',
      title: 'Earlier task',
      description: 'Fix the application',
      category: 'test',
      status: 'verified',
    })
  );
  writeFileSync(
    join(legacy, 'agent-output.md'),
    'First I will inspect the component.\n\n🔧 Tool: Read\nInput: {\n  "file_path": "src/app.tsx"\n}\n\nThe component is ready.\n\n## Tool results\n\n### Read (old-read-id)\n\n```json\n{"ok":true,"result":"Legacy file contents"}\n```\n\n---\n\n## Follow-up Session\n\nContinuing the task.'
  );
});
test.afterAll(() => cleanupTempDir(project));
test('native task history shows messages, thinking and tools, follows new sessions and survives reload', async ({
  page,
}) => {
  await setupRealProject(page, project, 'Agent chat', { setAsCurrent: true });
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
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/board');
  await page.getByTestId(`view-output-verified-${featureId}`).click();
  await expect(page.getByTestId('view-mode-chat')).toHaveClass(/bg-primary/);
  const chat = page.getByTestId('agent-chat');
  const history = chat.getByTestId('agent-chat-history');
  await expect(chat.getByTestId('chat-assistant')).toHaveCount(2);
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(chat.getByTestId('chat-task')).toContainText('Inspect the task history');
  await expect(chat.getByText('requirements')).toBeVisible();
  await expect(chat.getByTestId('chat-assistant')).toHaveCount(2);
  await expect(chat.getByRole('textbox')).toHaveCount(0);
  await chat.getByTestId('chat-thinking').locator('summary').click();
  await expect(chat.getByText('Provider reasoning summary')).toBeVisible();
  await chat.getByTestId('chat-tool').locator('summary').click();
  await expect(chat.getByText('Read fixture result')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('messenger-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chat).toBeVisible();
  expect(await history.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: test.info().outputPath('messenger-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await history.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  // Real persisted history is fetched again while the modal stays open.
  appendFileSync(
    join(directory, 'agent-conversation.jsonl'),
    [
      record('second', 0, 'session_start'),
      record(
        'second',
        1,
        'assistant',
        'Detailed progress paragraph.\n\n'.repeat(40) + 'Follow-up result.'
      ),
      record('second', 2, 'session_end', '', { status: 'completed' }),
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  );
  await expect(chat.getByText('Follow-up result.')).toBeVisible({ timeout: 10000 });
  await expect(chat.getByTestId('chat-session-start')).toHaveCount(2);
  expect(await history.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await history.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBe(0);
  appendFileSync(
    join(directory, 'agent-conversation.jsonl'),
    [
      record('third', 0, 'session_start'),
      record('third', 1, 'assistant', 'Late update.'),
      record('third', 2, 'session_end', '', { status: 'completed' }),
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  );
  await expect(chat.getByTestId('chat-new-messages')).toBeVisible({ timeout: 10000 });
  expect(await history.evaluate((node) => node.scrollTop)).toBe(0);
  await chat.getByTestId('chat-new-messages').click();
  await expect(chat.getByText('Late update.')).toBeVisible();
  await page.reload();
  await page.getByTestId(`view-output-verified-${featureId}`).click();
  await expect(chat.getByTestId('chat-assistant')).toHaveCount(4);
  await expect(chat.getByTestId('chat-session-start')).toHaveCount(3);
  await expect(chat.getByText('Old output must not duplicate chat messages')).toHaveCount(0);
});

test('older tasks also display message bubbles and compact tool activity', async ({ page }) => {
  await setupRealProject(page, project, 'Agent chat', { setAsCurrent: true });
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
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/board');
  await page.getByTestId('view-output-verified-legacy-chat').click();
  const chat = page.getByTestId('agent-chat');
  await expect(chat.getByTestId('chat-assistant')).toHaveCount(3);
  await expect(chat.getByTestId('chat-session-start')).toHaveCount(1);
  await expect(chat.getByTestId('chat-task')).toContainText('Fix the application');
  await expect(chat.getByTestId('chat-tool')).toHaveCount(1);
  await expect(chat.getByTestId('chat-tool')).not.toHaveAttribute('open');
  await expect(chat.getByTestId('chat-tool')).toContainText('src/app.tsx');
  await expect(chat.getByTestId('chat-tool')).toContainText('Completed');
  await expect(chat.getByRole('heading', { name: 'Tool results' })).toHaveCount(0);
  await chat.getByTestId('chat-tool').locator('summary').click();
  await expect(chat.getByTestId('chat-tool')).toContainText('Legacy file contents');
  await expect(chat.getByText('The component is ready.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('messenger-legacy.png') });
});
