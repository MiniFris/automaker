import { createSetupCommandValidation } from '../../../src/modules/providers/setup-command.validation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExecuteOptions } from '@automaker/types';
import { SettingsService } from '@/services/settings-service.js';
import { ProviderRegistry } from '@/modules/providers/provider-registry.service.js';
import { createNativeLocalWorktree } from '../../helpers/native-local-worktree.js';
import { ClaudeVerificationService } from '@/modules/providers/claude-verification.service.js';
import { ProviderConnectionRepository } from '@/modules/providers/provider-connection.repository.js';
import { CodexVerificationService } from '@/modules/providers/codex-verification.service.js';
import { SetupCredentialCache } from '@/modules/providers/setup-credential-cache.service.js';

let directory: string, project: string, settings: SettingsService;
let fixture: Awaited<ReturnType<typeof createNativeLocalWorktree>>;
let providers: ProviderRegistry;
beforeEach(async () => {
  fixture = await createNativeLocalWorktree();
  directory = fixture.root;
  project = fixture.project;
  settings = fixture.runtime.settings;
  await fixture.git(['checkout', '-b', 'feature']);
  await fs.writeFile(path.join(project, 'source.txt'), 'after\n');
  providers = fixture.runtime.app.get(ProviderRegistry);
  await settings.updateGlobalSettings({
    modelTimeouts: { commitMessageTimeoutMs: 1000, prDescriptionTimeoutMs: 1000 },
    providerModelTimeouts: { claude: { commitMessageTimeoutMs: 20, prDescriptionTimeoutMs: 20 } },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fixture?.close();
});

it.each([
  ['commit', 'generate-commit-message'],
  ['PR', 'generate-pr-description'],
] as const)(
  'uses the saved %s generation deadline and aborts the underlying model before cleanup',
  async (_label, create) => {
    let signal: AbortSignal | undefined;
    let cleaned = false;
    vi.spyOn(providers, 'providerForModel').mockReturnValue({
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
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const response = await fixture.post(create, {
      worktreePath: project,
      ...(create === 'generate-pr-description' ? { baseBranch: 'main' } : {}),
    });
    expect(signal?.aborted).toBe(true);
    expect(cleaned).toBe(true);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 20);
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('AI provider timed out after 20ms');
  }
);

it.each(['Claude', 'Codex'] as const)(
  'uses the shared connection-test timeout for the %s authentication probe',
  async (label) => {
    // The retired flag must not turn a real auth probe into a successful mock.
    vi.stubEnv('AUTOMAKER_MOCK_AGENT', 'true');
    await settings.updateGlobalSettings({
      modelTimeouts: { connectionTestTimeoutMs: 9999 },
      providerModelTimeouts: {
        claude: { connectionTestTimeoutMs: 4321 },
        codex: { connectionTestTimeoutMs: 4321 },
      },
    });
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const json = vi.fn();
    const keys = new SetupCredentialCache();
    if (label === 'Claude') {
      const service = new ClaudeVerificationService(
        { run: vi.fn() } as never,
        ProviderConnectionRepository.forWorkingDirectory(project),
        {},
        keys,
        settings,
        createSetupCommandValidation()
      );
      json(
        await service.verify(
          { confirmed: true, target: service.target('api_key').target, apiKey: 'invalid' },
          'fixture'
        )
      );
    } else {
      const service = new CodexVerificationService(
        { run: vi.fn() } as never,
        { read: vi.fn() } as never,
        ProviderConnectionRepository.forWorkingDirectory(project),
        {},
        keys,
        settings,
        createSetupCommandValidation()
      );
      json(
        await service.verify(
          { confirmed: true, target: (await service.target('api_key')).target, apiKey: 'invalid' },
          'fixture'
        )
      );
    }
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 4321);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ authenticated: false }));
  }
);
