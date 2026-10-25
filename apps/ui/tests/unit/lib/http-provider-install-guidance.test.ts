import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';

const request = vi.fn();
const target = {
  kind: 'host-application',
  provider: 'claude',
  workingDirectory: '/backend',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
};
const guidance = {
  success: false,
  requiresManualInstall: true,
  installationPerformed: false,
  installCommand: 'npm install -g @anthropic-ai/claude-code',
  target,
};
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
beforeEach(() => vi.stubGlobal('fetch', request));
afterEach(() => vi.unstubAllGlobals());

it.each(['claude', 'codex'] as const)(
  'validates %s guidance and forwards cancellation',
  async (provider) => {
    const body = { ...guidance, success: provider === 'codex', target: { ...target, provider } };
    request.mockResolvedValue(reply(body));
    const client = new HttpApiClient();
    const controller = new AbortController();
    const result =
      provider === 'claude'
        ? await client.setup.installClaude(controller.signal)
        : await client.setup.installCodex(controller.signal);
    expect(result).toEqual(body);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toContain(`/api/setup/install-${provider}`);
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', signal: controller.signal });
  }
);
it('rejects a provider mismatch', async () => {
  request.mockResolvedValue(reply(guidance));
  await expect(new HttpApiClient().setup.installCodex()).rejects.toThrow('does not match');
});
it.each([{ success: true }, { ...guidance, installationPerformed: true }])(
  'rejects an unproven response: %s',
  async (body) => {
    request.mockResolvedValue(reply(body));
    await expect(new HttpApiClient().setup.installClaude()).rejects.toThrow();
  }
);
