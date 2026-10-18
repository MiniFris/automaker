import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExecuteOptions } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { ProviderFactory } from '@/providers/provider-factory.js';
import { createGenerateCommitMessageHandler } from '@/routes/worktree/routes/generate-commit-message.js';
import { createGeneratePRDescriptionHandler } from '@/routes/worktree/routes/generate-pr-description.js';
import { createVerifyClaudeAuthHandler } from '@/routes/setup/routes/verify-claude-auth.js';
import { createVerifyCodexAuthHandler } from '@/routes/setup/routes/verify-codex-auth.js';

let directory: string, project: string, settings: SettingsService;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'model-helper-timeouts-'));
  project = path.join(directory, 'project');
  await fs.mkdir(project);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' });
  git('init', '-b', 'main');
  await fs.writeFile(path.join(project, 'fixture.txt'), 'before\n');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'Initial'
  );
  git('checkout', '-b', 'feature');
  await fs.writeFile(path.join(project, 'fixture.txt'), 'after\n');
  settings = new SettingsService(path.join(directory, 'data'));
  await settings.updateGlobalSettings({
    modelTimeouts: { commitMessageTimeoutMs: 1000, prDescriptionTimeoutMs: 1000 },
    providerModelTimeouts: { claude: { commitMessageTimeoutMs: 20, prDescriptionTimeoutMs: 20 } },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

it.each([
  ['commit', createGenerateCommitMessageHandler],
  ['PR', createGeneratePRDescriptionHandler],
] as const)(
  'uses the saved %s generation deadline and aborts the underlying model before cleanup',
  async (_label, create) => {
    let signal: AbortSignal | undefined;
    let cleaned = false;
    vi.spyOn(ProviderFactory, 'getProviderForModel').mockReturnValue({
      getName: () => 'fixture',
      async *executeQuery(options: ExecuteOptions) {
        signal = options.abortController!.signal;
        try {
          await new Promise((_resolve, reject) =>
            signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          );
          yield { type: 'result' };
        } finally {
          cleaned = true;
        }
      },
    } as never);
    const json = vi.fn();
    const status = vi.fn().mockReturnThis();
    await create(settings)(
      { body: { worktreePath: project, baseBranch: 'main' } } as Request,
      { json, status } as unknown as Response
    );
    expect(signal?.aborted).toBe(true);
    expect(cleaned).toBe(true);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('AI provider timed out after 20ms'),
      })
    );
  }
);

it.each([
  ['Claude', createVerifyClaudeAuthHandler],
  ['Codex', createVerifyCodexAuthHandler],
] as const)(
  'uses the shared connection-test timeout for the %s authentication probe',
  async (_label, create) => {
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'false');
    await settings.updateGlobalSettings({
      modelTimeouts: { connectionTestTimeoutMs: 9999 },
      providerModelTimeouts: {
        claude: { connectionTestTimeoutMs: 4321 },
        codex: { connectionTestTimeoutMs: 4321 },
      },
    });
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const json = vi.fn();
    await create(settings)(
      { body: { authMethod: 'api_key', apiKey: 'invalid' }, ip: 'fixture' } as Request,
      { json } as unknown as Response
    );
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 4321);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ authenticated: false }));
  }
);
