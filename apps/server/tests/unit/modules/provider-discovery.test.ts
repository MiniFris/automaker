import { expect, it, vi } from 'vitest';
import { ProviderDiscoveryService } from '../../../src/modules/providers/provider-discovery.service.js';

it('uses only passive native installation probes and grants no unknown provider presence', async () => {
  const detect = vi.fn(async (name: string) => ({
    installed: true,
    version: 'fixture',
    path: `/owned/${name}`,
    method: 'path',
  }));
  const discovery = new ProviderDiscoveryService({ detect } as never);
  const result = await discovery.statuses([
    'claude',
    'openai-compatible',
    'cursor',
    'codex',
    'opencode',
    'gemini',
    'copilot',
    'unknown',
  ]);
  expect(detect.mock.calls.map(([name]) => name)).toEqual([
    'cursor-agent',
    'codex',
    'opencode',
    'gemini',
    'copilot',
  ]);
  expect(result.claude).toEqual({ installed: true, method: 'sdk' });
  expect(result.unknown.installed).toBe(false);
  expect(result.cursor).toEqual({
    installed: true,
    method: 'cli',
    version: 'fixture',
    path: '/owned/cursor-agent',
  });
  for (const status of Object.values(result)) expect(status).not.toHaveProperty('authenticated');
});
