import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import * as platform from '@automaker/platform';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';

const probes = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: (input: unknown) => {
    probes.claude(input);
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'offline' };
    })();
  },
}));
vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(input: unknown) {
      probes.codex(input);
    }
    startThread() {
      return { id: 'offline-thread', run: async () => ({ finalResponse: 'offline' }) };
    }
  },
}));

it('wires live application credential snapshots into real provider factories and preserves deletion on restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-key-policy-http-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const before = { ...process.env };
  vi.spyOn(platform, 'findCodexCliPath').mockResolvedValue(null);
  vi.spyOn(platform, 'getCodexAuthIndicators').mockResolvedValue({
    hasApiKey: false,
    hasOAuthToken: false,
    hasAuthFile: false,
  } as never);
  const start = async (name: string) => {
    const app = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: directory,
      dataDir: path.join(directory, name),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture',
        ENABLE_REQUEST_LOGGING: 'false',
        ANTHROPIC_API_KEY: `sk-ant-bootstrap-${name}`,
        OPENAI_API_KEY: `sk-bootstrap-${name}`,
      },
    });
    apps.push(app);
    await app.start();
    return { app, settings: app.app.get(SettingsService), registry: app.app.get(ProviderRegistry) };
  };
  const query = async (registry: ProviderRegistry, provider: 'claude' | 'codex') => {
    const messages = [];
    for await (const message of registry.byName(provider)!.executeQuery({
      prompt: 'offline',
      cwd: directory,
      model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.2-codex',
      allowedTools: [],
      codexSettings: { autoLoadAgents: false },
    }))
      messages.push(message);
    return messages;
  };
  try {
    const first = await start('first');
    const second = await start('second');
    await first.settings.setSetupCredential('anthropic', 'sk-ant-managed-first');
    await first.settings.setSetupCredential('openai', 'sk-managed-first');
    await query(first.registry, 'claude');
    await query(second.registry, 'claude');
    expect(probes.claude.mock.calls.map(([input]) => input.options.env.ANTHROPIC_API_KEY)).toEqual([
      'sk-ant-managed-first',
      'sk-ant-bootstrap-second',
    ]);
    await query(first.registry, 'codex');
    await query(second.registry, 'codex');
    expect(probes.codex.mock.calls.map(([input]) => input.apiKey)).toEqual([
      'sk-managed-first',
      'sk-bootstrap-second',
    ]);
    await first.settings.setSetupCredential('anthropic', null);
    await first.settings.setSetupCredential('openai', null);
    await first.app.app.close();
    const restarted = await start('first');
    await query(restarted.registry, 'claude');
    expect(probes.claude.mock.calls.at(-1)![0].options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(
      (await query(restarted.registry, 'codex')).some((message) => message.type === 'error')
    ).toBe(true);
    expect(probes.codex).toHaveBeenCalledTimes(2);
    expect(process.env).toEqual(before);
  } finally {
    for (const app of apps) await app.app.close();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
